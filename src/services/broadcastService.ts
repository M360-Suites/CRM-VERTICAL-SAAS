/**
 * Broadcasts — bulk email to contacts through Amazon SES.
 *  - buildAudienceFilter: turns a broadcast audience into a Contact query
 *  - startBroadcast: snapshots the audience into BroadcastRecipient rows
 *  - sendNextBroadcastRecipient: called by the dispatcher, one email at a time
 */
import mongoose from 'mongoose';
import { Broadcast, type IBroadcast, type IBroadcastAudience } from '../models/Broadcast';
import { BroadcastRecipient, type IBroadcastRecipient } from '../models/BroadcastRecipient';
import { Contact } from '../models/Contact';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { logger } from '../config/logger';
import { sendSesEmail } from '../utils/sesMailer';
import { buildUnsubscribeUrl, renderEmail } from '../utils/emailTemplateRender';

const INSERT_CHUNK = 500;

/**
 * Audience rules:
 *  - contact_ids given → exactly those contacts
 *  - all → every contact in the org
 *  - otherwise → contacts matching every filter given (tags match any listed tag)
 * Contacts without an email or who opted out are always excluded.
 */
export const buildAudienceFilter = (
  organizationId: mongoose.Types.ObjectId,
  audience: IBroadcastAudience
): Record<string, unknown> | null => {
  const filter: Record<string, unknown> = {
    organization_id: organizationId,
    email: { $exists: true, $nin: [null, ''] },
    email_opt_out: { $ne: true }
  };

  if (audience.contact_ids?.length) {
    filter._id = { $in: audience.contact_ids };
    return filter;
  }
  if (audience.all) return filter;

  let narrowed = false;
  if (audience.tags?.length) {
    filter.tags = { $in: audience.tags };
    narrowed = true;
  }
  if (audience.temperature?.length) {
    filter.temperature = { $in: audience.temperature };
    narrowed = true;
  }
  if (audience.owner_ids?.length) {
    filter.owner_id = { $in: audience.owner_ids };
    narrowed = true;
  }
  if (audience.company_ids?.length) {
    filter.company_id = { $in: audience.company_ids };
    narrowed = true;
  }

  return narrowed ? filter : null;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

/**
 * Move a draft/scheduled broadcast into `sending` and snapshot its recipients.
 * Returns the number of recipients queued.
 */
export const startBroadcast = async (broadcastId: mongoose.Types.ObjectId, sentBy?: mongoose.Types.ObjectId): Promise<number> => {
  const broadcast = await Broadcast.findOneAndUpdate(
    { _id: broadcastId, status: { $in: ['draft', 'scheduled'] } },
    { $set: { status: 'sending', started_at: new Date(), ...(sentBy ? { sent_by: sentBy } : {}) } },
    { new: true }
  );
  if (!broadcast) throw new Error('Broadcast is not in a sendable state');

  const filter = buildAudienceFilter(broadcast.organization_id, broadcast.audience);
  let queued = 0;

  if (filter) {
    const cursor = Contact.find(filter).select('_id email first_name last_name').lean().cursor();
    let batch: Array<Record<string, unknown>> = [];

    const flush = async () => {
      if (batch.length === 0) return;
      let inserted = 0;
      try {
        inserted = (await BroadcastRecipient.insertMany(batch, { ordered: false })).length;
      } catch (error) {
        // Duplicate emails across contacts are dropped by the unique index; keep the rest
        const insertedDocs = (error as { insertedDocs?: unknown[] }).insertedDocs;
        if (!isDuplicateKeyError(error) && !Array.isArray(insertedDocs)) throw error;
        inserted = Array.isArray(insertedDocs) ? insertedDocs.length : 0;
      }
      batch = [];
      queued += inserted;
      // Counted per chunk so the total is right even while the snapshot is still running
      await Broadcast.updateOne({ _id: broadcast._id }, { $inc: { 'stats.total': inserted } });
    };

    for await (const contact of cursor) {
      batch.push({
        organization_id: broadcast.organization_id,
        broadcast_id: broadcast._id,
        contact_id: contact._id,
        email: String(contact.email).toLowerCase().trim(),
        name: [contact.first_name, contact.last_name].filter(Boolean).join(' ')
      });
      if (batch.length >= INSERT_CHUNK) await flush();
    }
    await flush();
  }

  if (queued === 0) {
    await Broadcast.updateOne(
      { _id: broadcast._id },
      { $set: { status: 'failed', error: 'No eligible recipients in the audience', completed_at: new Date() } }
    );
    return 0;
  }

  return queued;
};

/** Start scheduled broadcasts whose time has come */
export const startDueScheduledBroadcasts = async (): Promise<void> => {
  const due = await Broadcast.find({ status: 'scheduled', scheduled_at: { $lte: new Date() } }).select('_id').lean();
  for (const { _id } of due) {
    try {
      await startBroadcast(_id);
    } catch (error) {
      logger.error({ err: error, broadcastId: String(_id) }, 'Failed to start scheduled broadcast');
    }
  }
};

const claimNextRecipient = async (): Promise<IBroadcastRecipient | null> => {
  const sending = await Broadcast.find({ status: 'sending' }).select('_id').sort({ started_at: 1 }).lean();
  for (const { _id } of sending) {
    const recipient = await BroadcastRecipient.findOneAndUpdate(
      { broadcast_id: _id, status: 'queued' },
      { $set: { status: 'sending' } },
      { new: true }
    );
    if (recipient) return recipient;

    // Nothing left to claim — close it out once in-flight sends finish
    const inFlight = await BroadcastRecipient.exists({ broadcast_id: _id, status: 'sending' });
    if (!inFlight) {
      await Broadcast.updateOne({ _id, status: 'sending' }, { $set: { status: 'sent', completed_at: new Date() } });
    }
  }
  return null;
};

type BroadcastSendContext = {
  broadcast: Pick<IBroadcast, '_id' | 'subject' | 'html' | 'preview_text'>;
  organizationName?: string;
  replyTo?: string;
};

const contextCache = new Map<string, { value: BroadcastSendContext | null; expires: number }>();

const loadSendContext = async (broadcastId: mongoose.Types.ObjectId): Promise<BroadcastSendContext | null> => {
  const key = String(broadcastId);
  const cached = contextCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const broadcast = await Broadcast.findById(broadcastId)
    .select('_id subject html preview_text status organization_id sent_by')
    .lean();
  let value: BroadcastSendContext | null = null;

  if (broadcast && broadcast.status === 'sending') {
    const [organization, sender] = await Promise.all([
      Organization.findById(broadcast.organization_id).select('name').lean(),
      broadcast.sent_by ? User.findById(broadcast.sent_by).select('email').lean() : Promise.resolve(null)
    ]);
    value = { broadcast, organizationName: organization?.name, replyTo: sender?.email };
  }

  // Short TTL so a cancel takes effect within a few seconds
  contextCache.set(key, { value, expires: Date.now() + 5_000 });
  return value;
};

/**
 * Send one queued broadcast email. Returns false when nothing was queued.
 */
export const sendNextBroadcastRecipient = async (): Promise<boolean> => {
  const recipient = await claimNextRecipient();
  if (!recipient) return false;

  const settle = async (status: IBroadcastRecipient['status'], extra: Record<string, unknown> = {}) => {
    await BroadcastRecipient.updateOne({ _id: recipient._id }, { $set: { status, ...extra } });
    const counter = status === 'sent' ? 'stats.sent' : status === 'skipped' ? 'stats.skipped' : 'stats.failed';
    await Broadcast.updateOne({ _id: recipient.broadcast_id }, { $inc: { [counter]: 1 } });
  };

  try {
    const context = await loadSendContext(recipient.broadcast_id);
    if (!context) {
      // Broadcast was cancelled mid-send
      await settle('skipped', { error: 'Broadcast cancelled' });
      return true;
    }

    const contact = await Contact.findOne({ _id: recipient.contact_id, organization_id: recipient.organization_id })
      .select('first_name last_name email phone role_title company_id email_opt_out')
      .populate('company_id', 'name')
      .lean();
    if (!contact || contact.email_opt_out) {
      await settle('skipped', { error: contact ? 'Contact has unsubscribed' : 'Contact was deleted' });
      return true;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(String(contact._id));
    const rendered = renderEmail(context.broadcast, {
      contact,
      company: contact.company_id as unknown as { name?: string } | null,
      organization: { name: context.organizationName },
      unsubscribe_url: unsubscribeUrl
    });

    const messageId = await sendSesEmail({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      fromName: context.organizationName,
      replyTo: context.replyTo,
      unsubscribeUrl,
      tags: { kind: 'broadcast', broadcast_id: String(recipient.broadcast_id) }
    });

    await settle('sent', { ses_message_id: messageId, sent_at: new Date() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ err: error, recipientId: String(recipient._id) }, 'Broadcast email failed');
    await settle('failed', { error: message }).catch(() => undefined);
  }

  return true;
};

/** Cancel a scheduled or in-progress broadcast; queued recipients are marked skipped */
export const cancelBroadcast = async (broadcastId: mongoose.Types.ObjectId, organizationId: mongoose.Types.ObjectId) => {
  const broadcast = await Broadcast.findOneAndUpdate(
    { _id: broadcastId, organization_id: organizationId, status: { $in: ['scheduled', 'sending'] } },
    { $set: { status: 'cancelled', completed_at: new Date() } },
    { new: true }
  );
  if (!broadcast) return null;

  const { modifiedCount } = await BroadcastRecipient.updateMany(
    { broadcast_id: broadcastId, status: 'queued' },
    { $set: { status: 'skipped', error: 'Broadcast cancelled' } }
  );
  await Broadcast.updateOne({ _id: broadcastId }, { $inc: { 'stats.skipped': modifiedCount } });
  contextCache.delete(String(broadcastId));
  return broadcast;
};
