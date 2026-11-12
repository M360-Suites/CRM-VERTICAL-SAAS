/**
 * Email suppressions — contacts who no longer receive broadcasts or trigger emails
 * because they unsubscribed, hard-bounced or complained (Contact.email_opt_out).
 */
import { Response } from 'express';
import { AuthRequest } from '../types';
import { Contact, type EmailOptOutReason } from '../models/Contact';
import { requireOrganization } from '../utils/tenant';
import { optionalEnum, optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { handleError } from '../utils/errorHandler';

const REASONS: readonly EmailOptOutReason[] = ['unsubscribed', 'bounced', 'complained'];

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const serializeSuppression = (contact: any) => ({
  contact_id: contact._id,
  name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
  email: contact.email ?? null,
  reason: contact.email_opt_out_reason ?? null,
  suppressed_at: contact.email_opt_out_at ?? null
});

/**
 * GET /email-suppressions?reason&search&page&limit — newest first
 */
export const listSuppressions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const filter: Record<string, unknown> = { organization_id: organizationId, email_opt_out: true };
    const reason = optionalEnum(req.query.reason, REASONS);
    if (reason) filter.email_opt_out_reason = reason;
    const search = optionalString(req.query.search, 100);
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: 'i' };
      filter.$or = [{ email: pattern }, { first_name: pattern }, { last_name: pattern }];
    }

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 50, 200);
    const [contacts, total, counts] = await Promise.all([
      Contact.find(filter)
        .select('first_name last_name email email_opt_out_reason email_opt_out_at')
        .sort({ email_opt_out_at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Contact.countDocuments(filter),
      Contact.aggregate<{ _id: EmailOptOutReason | null; count: number }>([
        { $match: { organization_id: organizationId, email_opt_out: true } },
        { $group: { _id: '$email_opt_out_reason', count: { $sum: 1 } } }
      ])
    ]);

    const byReason = Object.fromEntries(REASONS.map((key) => [key, 0])) as Record<EmailOptOutReason, number>;
    for (const row of counts) if (row._id && row._id in byReason) byReason[row._id] = row.count;

    res.json({
      status: true,
      data: {
        data: contacts.map(serializeSuppression),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        counts: byReason
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load suppressions');
  }
};

/**
 * DELETE /email-suppressions/:contactId — let the contact receive email again.
 * Only for when the contact asked to rejoin, or a bounce was fixed (e.g. a typo
 * in the address was corrected).
 */
export const removeSuppression = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contactId = optionalObjectId(req.params.contactId);
    if (!contactId) {
      res.status(400).json({ status: false, message: 'Invalid contact ID' });
      return;
    }

    const contact = await Contact.findOneAndUpdate(
      { _id: contactId, organization_id: organizationId, email_opt_out: true },
      { $set: { email_opt_out: false }, $unset: { email_opt_out_reason: 1, email_opt_out_at: 1 } },
      { new: true }
    )
      .select('first_name last_name email')
      .lean();

    if (!contact) {
      const exists = await Contact.exists({ _id: contactId, organization_id: organizationId });
      res.status(exists ? 409 : 404).json({
        status: false,
        message: exists ? 'This contact is not suppressed' : 'Contact not found'
      });
      return;
    }

    res.json({
      status: true,
      message: `${contact.email ?? 'Contact'} will receive email again`,
      data: { contact_id: contact._id, email: contact.email ?? null }
    });
  } catch (error) {
    handleError(res, error, 'Failed to remove suppression');
  }
};
