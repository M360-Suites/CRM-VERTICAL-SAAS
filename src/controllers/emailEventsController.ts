/**
 * Public email endpoints
 *  - Unsubscribe links from broadcasts/triggers (GET shows a confirm page, POST opts out;
 *    POST also serves RFC 8058 one-click unsubscribe from mail clients)
 *  - Amazon SES bounce/complaint notifications delivered via SNS
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

/* ---- SES notifications via SNS ---- */

type SnsMessage = {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
};

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map<string, string>();

const isSnsUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname);
  } catch {
    return false;
  }
};

const stringToSign = (message: SnsMessage): string => {
  const keys =
    message.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys
    .filter((key) => message[key as keyof SnsMessage] !== undefined)
    .map((key) => `${key}\n${message[key as keyof SnsMessage]}\n`)
    .join('');
};

/** Verify the SNS signature against AWS's signing certificate */
export const verifySnsMessage = async (message: SnsMessage): Promise<boolean> => {
  if (!message?.Signature || !isSnsUrl(message.SigningCertURL)) return false;

  let cert = certCache.get(message.SigningCertURL);
  if (!cert) {
    const response = await fetch(message.SigningCertURL);
    if (!response.ok) return false;
    cert = await response.text();
    certCache.set(message.SigningCertURL, cert);
  }

  const algorithm = message.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  return crypto.createVerify(algorithm).update(stringToSign(message), 'utf8').verify(cert, message.Signature, 'base64');
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

/**
 * Apply one SES event. Supports both event publishing (eventType) and
 * identity notifications (notificationType).
 */
export const applySesEvent = async (event: Record<string, any>): Promise<void> => {
  const type: string | undefined = event.eventType ?? event.notificationType;
  const messageId: string | undefined = event.mail?.messageId;

  let emails: string[] = [];
  let reason: EmailOptOutReason | null = null;

  if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
    emails = (event.bounce.bouncedRecipients ?? []).map((r: { emailAddress: string }) => r.emailAddress);
    reason = 'bounced';
  } else if (type === 'Complaint') {
    emails = (event.complaint?.complainedRecipients ?? []).map((r: { emailAddress: string }) => r.emailAddress);
    reason = 'complained';
  }
  if (!reason || emails.length === 0) return;

  const recipientStatus = reason === 'bounced' ? 'bounced' : 'complained';
  let organizationId: mongoose.Types.ObjectId | undefined;

  if (messageId) {
    const recipient = await BroadcastRecipient.findOneAndUpdate(
      { ses_message_id: messageId, status: { $ne: recipientStatus } },
      { $set: { status: recipientStatus } }
    ).lean();
    if (recipient) {
      organizationId = recipient.organization_id;
      await Broadcast.updateOne({ _id: recipient.broadcast_id }, { $inc: { [`stats.${recipientStatus}`]: 1 } });
    } else {
      const run = await TriggerRun.findOneAndUpdate(
        { ses_message_id: messageId },
        { $set: { error: reason === 'bounced' ? 'Hard bounce' : 'Marked as spam' } }
      ).lean();
      organizationId = run?.organization_id;
    }
  }

  // A hard bounce means the address is dead everywhere; a complaint is about this sender
  await optOutAddresses(emails, reason, reason === 'complained' ? organizationId : undefined);
};

/**
 * POST /api/webhooks/ses — SNS delivers SES bounce/complaint events here
 */
export const handleSesWebhook = async (req: Request, res: Response): Promise<void> => {
  const message = req.body as SnsMessage;

  try {
    if (config.SES_SNS_TOPIC_ARN && message?.TopicArn !== config.SES_SNS_TOPIC_ARN) {
      res.status(403).json({ status: false, message: 'Unknown topic' });
      return;
    }
    if (!(await verifySnsMessage(message))) {
      res.status(403).json({ status: false, message: 'Invalid signature' });
      return;
    }

    if (message.Type === 'SubscriptionConfirmation') {
      if (isSnsUrl(message.SubscribeURL)) await fetch(message.SubscribeURL!);
      logger.info({ topic: message.TopicArn }, 'Confirmed SES SNS subscription');
    } else if (message.Type === 'Notification') {
      await applySesEvent(JSON.parse(message.Message));
    }

    res.json({ status: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to handle SES notification');
    res.status(500).json({ status: false, message: 'Failed to process notification' });
  }
};
