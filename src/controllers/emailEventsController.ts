/**
 * Public email endpoints
 *  - Unsubscribe links from broadcasts/triggers (GET shows a confirm page, POST opts out;
 *    POST also serves RFC 8058 one-click unsubscribe from mail clients)
 *  - Sender.net bounce webhooks (bounces/new)
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import config from '../config';
import { logger } from '../config/logger';
import { Contact, type EmailOptOutReason } from '../models/Contact';
import { BroadcastRecipient } from '../models/BroadcastRecipient';
import { Broadcast } from '../models/Broadcast';
import { TriggerRun } from '../models/TriggerRun';
import { verifyUnsubscribeToken } from '../utils/emailTemplateRender';

/* ---- Unsubscribe ---- */

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1f2933;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border-radius:12px;padding:32px;max-width:420px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
button{background:#1f2933;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer}</style>
</head><body><main>${body}</main></body></html>`;

const tokenFrom = (req: Request): string => {
  const value = req.query.token ?? (req.body as Record<string, unknown> | undefined)?.token;
  return typeof value === 'string' ? value : '';
};

const findContactForToken = (token: string) => {
  const contactId = verifyUnsubscribeToken(token);
  if (!contactId || !mongoose.Types.ObjectId.isValid(contactId)) return null;
  return contactId;
};

/**
 * GET /public/email/unsubscribe?token= — confirmation page. Doesn't opt out on its own,
 * so link scanners that prefetch URLs can't unsubscribe people.
 */
export const showUnsubscribePage = (req: Request, res: Response): void => {
  const token = tokenFrom(req);
  if (!findContactForToken(token)) {
    res.status(400).type('html').send(page('Invalid link', '<h1>Invalid link</h1><p>This unsubscribe link is invalid or incomplete.</p>'));
    return;
  }

  const safeToken = token.replace(/[^A-Za-z0-9._-]/g, '');
  res.type('html').send(
    page(
      'Unsubscribe',
      `<h1>Unsubscribe</h1><p>Stop receiving these emails?</p>
<form method="post"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Unsubscribe</button></form>`
    )
  );
};

/**
 * POST /public/email/unsubscribe — opt the contact out
 */
export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
  const contactId = findContactForToken(tokenFrom(req));
  if (!contactId) {
    res.status(400).type('html').send(page('Invalid link', '<h1>Invalid link</h1><p>This unsubscribe link is invalid or incomplete.</p>'));
    return;
  }

  try {
    await Contact.updateOne(
      { _id: contactId, email_opt_out: { $ne: true } },
      { $set: { email_opt_out: true, email_opt_out_reason: 'unsubscribed', email_opt_out_at: new Date() } }
    );
    res.type('html').send(page('Unsubscribed', "<h1>You're unsubscribed</h1><p>You won't receive these emails anymore.</p>"));
  } catch (error) {
    logger.error({ err: error }, 'Unsubscribe failed');
    res.status(500).type('html').send(page('Something went wrong', '<h1>Something went wrong</h1><p>Please try again later.</p>'));
  }
};

/* ---- Sender.net bounce webhook ---- */

const timingSafeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const optOutAddresses = async (
  emails: string[],
  reason: EmailOptOutReason,
  organizationId?: mongoose.Types.ObjectId
): Promise<void> => {
  for (const email of emails) {
    await Contact.updateMany(
      {
        email: { $regex: `^${escapeRegex(email.trim())}$`, $options: 'i' },
        email_opt_out: { $ne: true },
        ...(organizationId ? { organization_id: organizationId } : {})
      },
      { $set: { email_opt_out: true, email_opt_out_reason: reason, email_opt_out_at: new Date() } }
    );
  }
};

const firstString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.trim() !== '');

/**
 * Apply one Sender.net bounce event. Sender doesn't publish the bounces/new
 * schema, so the address, email id and bounce type are read from the fields
 * its other payloads use, at the top level or under `data`.
 */
export const applySenderBounce = async (event: Record<string, any>): Promise<void> => {
  const data: Record<string, any> = event?.data && typeof event.data === 'object' ? event.data : event ?? {};
  const email = firstString(data.email, data.recipient, data.to?.email, data.subscriber?.email, event?.email);
  const messageId = firstString(data.emailId, data.email_id, data.message_id, event?.emailId);
  const bounceType = firstString(data.bounce_type, data.type, data.status?.email)?.toLowerCase() ?? '';

  if (!email) {
    logger.warn({ event }, 'Sender.net bounce webhook without a recipient address');
    return;
  }
  // A soft bounce (full mailbox, greylisting) isn't a dead address
  if (bounceType.includes('soft')) return;

  if (messageId) {
    const recipient = await BroadcastRecipient.findOneAndUpdate(
      { message_id: messageId, status: { $ne: 'bounced' } },
      { $set: { status: 'bounced' } }
    ).lean();
    if (recipient) {
      await Broadcast.updateOne({ _id: recipient.broadcast_id }, { $inc: { 'stats.bounced': 1 } });
    } else {
      await TriggerRun.updateOne({ message_id: messageId }, { $set: { error: 'Hard bounce' } });
    }
  }

  // A hard bounce means the address is dead everywhere
  await optOutAddresses([email], 'bounced');
};

/**
 * POST /api/webhooks/sender?secret= — Sender.net delivers bounces/new events here
 */
export const handleSenderWebhook = async (req: Request, res: Response): Promise<void> => {
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  if (!config.SENDER_WEBHOOK_SECRET || !timingSafeEqual(secret, config.SENDER_WEBHOOK_SECRET)) {
    res.status(403).json({ status: false, message: 'Invalid secret' });
    return;
  }

  try {
    const body = req.body as unknown;
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) await applySenderBounce(event as Record<string, any>);
    res.json({ status: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to handle Sender.net webhook');
    res.status(500).json({ status: false, message: 'Failed to process webhook' });
  }
};
