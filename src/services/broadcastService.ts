/**
 * Broadcasts — bulk email to contacts through Ensend.
 *  - buildAudienceFilter: turns a broadcast audience into a Contact query
 *  - startBroadcast: snapshots the audience into BroadcastRecipient rows
 *  - sendNextBroadcastBatch: called by the dispatcher; claims up to 250 queued
 *    recipients and sends them as one Ensend broadcast batch, personalised via
 *    per-recipient variables
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Broadcast, type IBroadcast, type IBroadcastAudience } from '../models/Broadcast';
import { BroadcastRecipient, type IBroadcastRecipient } from '../models/BroadcastRecipient';
import { Contact } from '../models/Contact';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { logger } from '../config/logger';
import config from '../config';
import {
  ENSEND_BROADCAST_BATCH_SIZE,
  EmailRateLimitError,
  EnsendApiError,
  sendBroadcastBatch,
  toEnsendTemplate,
  type EnsendTemplate
} from '../utils/ensendMailer';
import { buildMergeValues, buildUnsubscribeUrl, prepareTemplateHtml } from '../utils/emailTemplateRender';

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

/**
 * Claim up to one Ensend batch of queued recipients from the oldest sending
 * broadcast. Claimed rows get a unique claim_id so concurrent dispatchers never
 * pick up the same recipients. Broadcasts with nothing left are closed out.
 */
const claimNextBatch = async (): Promise<{ broadcastId: mongoose.Types.ObjectId; recipients: IBroadcastRecipient[] } | null> => {
  const sending = await Broadcast.find({ status: 'sending' }).select('_id').sort({ started_at: 1 }).lean();

  for (const { _id } of sending) {
    const candidates = await BroadcastRecipient.find({ broadcast_id: _id, status: 'queued' })
      .select('_id')
      .sort({ _id: 1 })
      .limit(ENSEND_BROADCAST_BATCH_SIZE)
      .lean();

    if (candidates.length > 0) {
      const claimId = crypto.randomUUID();
      await BroadcastRecipient.updateMany(
        { _id: { $in: candidates.map((candidate) => candidate._id) }, status: 'queued' },
        { $set: { status: 'sending', claim_id: claimId } }
      );
      const recipients = await BroadcastRecipient.find({ claim_id: claimId, status: 'sending' });
      if (recipients.length > 0) return { broadcastId: _id, recipients };
      continue;
    }

    // Nothing left to claim — close it out once in-flight batches finish
    const inFlight = await BroadcastRecipient.exists({ broadcast_id: _id, status: 'sending' });
    if (!inFlight) {
      await Broadcast.updateOne({ _id, status: 'sending' }, { $set: { status: 'sent', completed_at: new Date() } });
    }
  }
  return null;
};

type BroadcastSendContext = {
  broadcast: Pick<IBroadcast, '_id' | 'subject' | 'html' | 'preview_text' | 'ensend_ref'>;
  template: EnsendTemplate;
  organizationName?: string;
  replyTo?: string;
};

const contextCache = new Map<string, { value: BroadcastSendContext | null; expires: number }>();

const loadSendContext = async (broadcastId: mongoose.Types.ObjectId): Promise<BroadcastSendContext | null> => {
  const key = String(broadcastId);
  const cached = contextCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const broadcast = await Broadcast.findById(broadcastId)
    .select('_id subject html preview_text status organization_id sent_by ensend_ref')
    .lean();
  let value: BroadcastSendContext | null = null;

  if (broadcast && broadcast.status === 'sending') {
    const [organization, sender] = await Promise.all([
      Organization.findById(broadcast.organization_id).select('name').lean(),
      broadcast.sent_by ? User.findById(broadcast.sent_by).select('email').lean() : Promise.resolve(null)
    ]);
    // Unsubscribe links need BACKEND_URL; without it the footer is left out (as before)
    const html = prepareTemplateHtml(broadcast, { withUnsubscribe: Boolean(config.BACKEND_URL) });
    value = {
      broadcast,
      template: toEnsendTemplate(broadcast.subject, html),
      organizationName: organization?.name,
      replyTo: sender?.email
    };
  }

  // Short TTL so a cancel takes effect within a few seconds
  contextCache.set(key, { value, expires: Date.now() + 5_000 });
  return value;
};

const settleRecipients = async (
  broadcastId: mongoose.Types.ObjectId,
  recipientIds: mongoose.Types.ObjectId[],
  status: 'sent' | 'failed' | 'skipped',
  extra: Record<string, unknown> = {}
): Promise<void> => {
  if (recipientIds.length === 0) return;
  const { modifiedCount } = await BroadcastRecipient.updateMany(
    { _id: { $in: recipientIds }, status: 'sending' },
    { $set: { status, ...extra }, $unset: { claim_id: '' } }
  );
  if (modifiedCount) {
    await Broadcast.updateOne({ _id: broadcastId }, { $inc: { [`stats.${status}`]: modifiedCount } });
  }
};

/**
 * Errors that will fail every batch the same way — stop the broadcast instead of
 * burning through the list. Auth errors always; request errors only on the first
 * batch (bad sender identity, bad content), since a later 400 may just be one bad address.
 */
const isFatalForBroadcast = (error: unknown, isFirstBatch: boolean): boolean =>
  error instanceof EnsendApiError &&
  ([401, 403].includes(error.statusCode) || (isFirstBatch && [400, 404, 422].includes(error.statusCode)));

const failBroadcast = async (broadcastId: mongoose.Types.ObjectId, reason: string): Promise<void> => {
  await Broadcast.updateOne(
    { _id: broadcastId, status: 'sending' },
    { $set: { status: 'failed', error: reason, completed_at: new Date() } }
  );
  const { modifiedCount } = await BroadcastRecipient.updateMany(
    { broadcast_id: broadcastId, status: 'queued' },
    { $set: { status: 'skipped', error: `Broadcast failed: ${reason}` } }
  );
  if (modifiedCount) await Broadcast.updateOne({ _id: broadcastId }, { $inc: { 'stats.skipped': modifiedCount } });
  contextCache.delete(String(broadcastId));
};

/**
 * Send the next batch of queued broadcast emails through Ensend.
 * Returns how many recipients were processed (0 when nothing was queued).
 */
export const sendNextBroadcastBatch = async (): Promise<number> => {
  const claimed = await claimNextBatch();
  if (!claimed) return 0;

  const { broadcastId, recipients } = claimed;
  const allIds = recipients.map((recipient) => recipient._id as mongoose.Types.ObjectId);
  let eligibleIds: mongoose.Types.ObjectId[] = [];
  let isFirstBatch = false;

  try {
    const context = await loadSendContext(broadcastId);
    if (!context) {
      // Broadcast was cancelled mid-send
      await settleRecipients(broadcastId, allIds, 'skipped', { error: 'Broadcast cancelled' });
      return recipients.length;
    }

    const contacts = await Contact.find({
      _id: { $in: recipients.map((recipient) => recipient.contact_id) },
      organization_id: recipients[0].organization_id
    })
      .select('first_name last_name email phone role_title company_id email_opt_out')
      .populate('company_id', 'name')
      .lean();
    const contactsById = new Map(contacts.map((contact) => [String(contact._id), contact]));

    const deletedIds: mongoose.Types.ObjectId[] = [];
    const optedOutIds: mongoose.Types.ObjectId[] = [];
    const batch: Array<{ address: string; name?: string; variables: Record<string, string> }> = [];

    for (const recipient of recipients) {
      const contact = contactsById.get(String(recipient.contact_id));
      if (!contact) {
        deletedIds.push(recipient._id as mongoose.Types.ObjectId);
        continue;
      }
      if (contact.email_opt_out) {
        optedOutIds.push(recipient._id as mongoose.Types.ObjectId);
        continue;
      }

      const values = buildMergeValues({
        contact,
        company: contact.company_id as unknown as { name?: string } | null,
        organization: { name: context.organizationName },
        unsubscribe_url: buildUnsubscribeUrl(String(contact._id))
      });
      batch.push({ address: recipient.email, name: recipient.name, variables: context.template.variablesFor(values) });
      eligibleIds.push(recipient._id as mongoose.Types.ObjectId);
    }

    await settleRecipients(broadcastId, deletedIds, 'skipped', { error: 'Contact was deleted' });
    await settleRecipients(broadcastId, optedOutIds, 'skipped', { error: 'Contact has unsubscribed' });
    if (batch.length === 0) return recipients.length;

    isFirstBatch = !context.broadcast.ensend_ref;
    const ref = await sendBroadcastBatch({
      broadcastRef: context.broadcast.ensend_ref,
      subject: context.template.subject,
      html: context.template.html,
      fromName: context.organizationName,
      replyTo: context.replyTo,
      recipients: batch
    });

    if (!context.broadcast.ensend_ref) {
      await Broadcast.updateOne({ _id: broadcastId }, { $set: { ensend_ref: ref } });
      context.broadcast.ensend_ref = ref;
    }

    await settleRecipients(broadcastId, eligibleIds, 'sent', { message_id: ref, sent_at: new Date() });
  } catch (error) {
    const pending = eligibleIds.length ? eligibleIds : allIds;

    if (error instanceof EmailRateLimitError) {
      // Nothing went out — put the batch back so it's sent once the limit lifts
      await BroadcastRecipient.updateMany(
        { _id: { $in: pending }, status: 'sending' },
        { $set: { status: 'queued' }, $unset: { claim_id: '' } }
      ).catch(() => undefined);
      return recipients.length;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.warn({ err: error, broadcastId: String(broadcastId), recipients: pending.length }, 'Broadcast batch failed');
    await settleRecipients(broadcastId, pending, 'failed', { error: message }).catch(() => undefined);
    if (isFatalForBroadcast(error, isFirstBatch)) await failBroadcast(broadcastId, message).catch(() => undefined);
  }

  return recipients.length;
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
