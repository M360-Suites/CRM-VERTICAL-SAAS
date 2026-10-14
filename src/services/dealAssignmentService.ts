import mongoose from 'mongoose';
import { Deal, IDeal } from '../models/Deal';
import { Contact } from '../models/Contact';
import { User } from '../models/User';
import { Activity } from '../models/Activity';
import { Notification } from '../models/Notification';
import { ROUTABLE_ROLES } from './leadRoutingService';
import { emitNotification } from './socketService';
import { logger } from '../config/logger';

export type AssignDealResult =
  | { ok: true; deal: IDeal; changed: boolean }
  | { ok: false; status: 400 | 404; message: string };

/**
 * Set (or clear, with ownerId null) the single owner of a deal.
 * The new owner must be an active admin / sales manager / sales rep in the same
 * organization. If the deal's contact has no owner yet, it follows the deal.
 * Logs a `deal_assigned` activity and notifies the new owner (best effort).
 */
export const assignDealOwner = async (params: {
  organizationId: mongoose.Types.ObjectId;
  dealId: string;
  ownerId: string | null;
  actorId?: string;
}): Promise<AssignDealResult> => {
  const { organizationId, dealId, ownerId, actorId } = params;

  const deal = await Deal.findOne({ _id: dealId, organization_id: organizationId }).select('title owner_id contact_id');
  if (!deal) return { ok: false, status: 404, message: 'Deal not found' };

  let owner: { _id: mongoose.Types.ObjectId; display_name: string } | null = null;
  if (ownerId) {
    owner = await User.findOne({
      _id: ownerId,
      organization_id: organizationId,
      is_active: true,
      role: { $in: ROUTABLE_ROLES }
    })
      .select('display_name')
      .lean<{ _id: mongoose.Types.ObjectId; display_name: string }>();
    if (!owner) {
      return { ok: false, status: 400, message: 'owner_id must be an active admin, sales manager or sales rep in your organization' };
    }
  }

  const previousOwnerId = deal.owner_id?.toString() ?? null;
  const changed = previousOwnerId !== (owner?._id.toString() ?? null);

  if (changed) {
    await Deal.updateOne(
      { _id: deal._id, organization_id: organizationId },
      owner ? { $set: { owner_id: owner._id } } : { $unset: { owner_id: 1 } }
    );

    if (owner && deal.contact_id) {
      await Contact.updateOne(
        { _id: deal.contact_id, organization_id: organizationId, owner_id: { $exists: false } },
        { $set: { owner_id: owner._id } }
      );
    }

    await Activity.create({
      type: 'deal_assigned',
      content: owner ? `Deal assigned to ${owner.display_name}` : 'Deal unassigned',
      deal_id: deal._id,
      user_id: actorId ? new mongoose.Types.ObjectId(actorId) : undefined,
      organization_id: organizationId,
      metadata: { previous_owner_id: previousOwnerId, owner_id: owner?._id.toString() ?? null }
    });

    if (owner && owner._id.toString() !== actorId) {
      try {
        const title = `Deal assigned to you: ${deal.title}`;
        await Notification.create({
          userId: owner._id,
          provider: 'internal',
          type: 'deal_assigned',
          title,
          metadata: { deal_id: deal._id.toString(), assigned_by: actorId ?? null, link: '/pipeline' }
        });
        emitNotification(owner._id.toString(), { provider: 'internal', title, createdAt: new Date() });
      } catch (error) {
        logger.warn({ err: error }, 'Failed to notify new deal owner');
      }
    }
  }

  const updated = await Deal.findOne({ _id: deal._id, organization_id: organizationId })
    .populate('stage_id', 'name order is_won is_lost')
    .populate('company_id', 'name industry website')
    .populate('contact_id', 'first_name last_name email')
    .populate('owner_id', 'email display_name');

  return { ok: true, deal: updated as IDeal, changed };
};
