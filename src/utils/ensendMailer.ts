/**
 * Outbound marketing/automated email through Ensend.
 *  - sendEmail: one message (triggers, test sends) — POST /send/mail
 *  - sendBroadcastBatch: up to 250 recipients per call — POST /send/mail/broadcast.
 *    The first batch creates the Ensend broadcast and returns its ref; later batches
 *    pass that ref and only add recipients (Ensend reuses the first batch's content).
 *  - toEnsendTemplate: turns our {{contact.first_name | fallback}} merge tags into
 *    flat Ensend placeholders ({{contact_first_name_or_1}}) plus a per-recipient
 *    variable builder, so Ensend personalises each message in the batch.
 *
 * Docs: https://docs.ensend.co/email-reference.md, https://docs.ensend.co/reference.md
 */
import type { Client } from 'ensend';
import config from '../config';

/** Ensend's per-request recipient cap for broadcasts */
export const ENSEND_BROADCAST_BATCH_SIZE = 250;
/** Used when Ensend answers 429 */
const RATE_LIMIT_BACKOFF_MS = 60_000;

const DEFAULT_SENDER_ADDRESS = 'm360@ensend.me';

export interface OutboundEmail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  /** Sender display name — defaults to ENSEND_NAME */
  fromName?: string;
  replyTo?: string;
}

export interface BroadcastBatchRecipient {
  address: string;
  name?: string;
  variables: Record<string, string>;
}

export interface BroadcastBatch {
  /** Ref returned by the first batch; omit to create a new Ensend broadcast */
  broadcastRef?: string;
  subject: string;
  html: string;
  fromName?: string;
  replyTo?: string;
  recipients: BroadcastBatchRecipient[];
}

/** Ensend answered 429 — nothing was sent, so the email(s) can be retried later */
export class EmailRateLimitError extends Error {
  constructor(message = 'Ensend rate limit reached') {
    super(message);
    this.name = 'EmailRateLimitError';
  }
}

/** Ensend rejected the request (bad sender identity, invalid payload, auth…) */
export class EnsendApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`Ensend ${statusCode}: ${message}`);
    this.name = 'EnsendApiError';
    this.statusCode = statusCode;
  }
}

let rateLimitedUntil = 0;
let client: Client<readonly string[], readonly string[]> | undefined;

export const isEmailConfigured = (): boolean => Boolean(config.ENSEND_SECRET);

/** True while backing off after a 429 */
export const isEmailRateLimited = (): boolean => Date.now() < rateLimitedUntil;

const getClient = () => {
  if (!isEmailConfigured()) {
    throw new Error('Ensend is not configured — set ENSEND_SECRET (and ENSEND_MAIL to a verified sender identity)');
  }
  if (!client) {
    // Loaded on first send: the SDK is ESM-only, and modules that merely import
    // this file (and their tests) shouldn't have to load it
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client: EnsendClient } = require('ensend') as typeof import('ensend');
    client = new EnsendClient({ secret: config.ENSEND_SECRET });
  }
  return client;
};

/** Strip characters that would break a display name */
const cleanName = (name: string | undefined): string | undefined => name?.replace(/["\r\n\\<>]/g, '').trim() || undefined;

const senderIdentity = (fromName?: string) => ({
  address: config.ENSEND_MAIL || DEFAULT_SENDER_ADDRESS,
  name: cleanName(fromName) ?? cleanName(config.ENSEND_NAME) ?? 'M360'
});

type EnsendResult = {
  data: { data?: Record<string, unknown> | null } | null;
  error: { message?: string; statusCode?: number; data?: Record<string, unknown> | null } | null;
};

/**
 * The SDK only treats HTTP 200 as success, so a 201/202 arrives in `error`.
 * Normalise: return the response payload on any 2xx, throw otherwise.
 */
const unwrap = (result: EnsendResult): Record<string, unknown> => {
  if (result.data) return result.data.data ?? {};

  const statusCode = Number(result.error?.statusCode ?? 500);
  if (statusCode >= 200 && statusCode < 300) return result.error?.data ?? {};

  if (statusCode === 429) {
    rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    throw new EmailRateLimitError();
  }

  throw new EnsendApiError(statusCode, result.error?.message || 'Request failed');
};

/** Send a single email. Returns Ensend's message ref. */
export const sendEmail = async (email: OutboundEmail): Promise<string> => {
  const ensend = getClient();
  if (isEmailRateLimited()) throw new EmailRateLimitError();

  const payload = unwrap(
    (await ensend.SendApi.SendMailMessage({
      subject: email.subject,
      message: email.html,
      sender: senderIdentity(email.fromName),
      recipients: [{ address: email.to, ...(cleanName(email.toName) ? { name: cleanName(email.toName) } : {}) }],
      ...(email.replyTo ? { replyAddress: email.replyTo } : {})
    })) as EnsendResult
  );

  return typeof payload.ref === 'string' ? payload.ref : '';
};

/** Send one broadcast batch (≤ 250 recipients). Returns the Ensend broadcast ref. */
export const sendBroadcastBatch = async (batch: BroadcastBatch): Promise<string> => {
  if (batch.recipients.length === 0) throw new Error('A broadcast batch needs at least one recipient');
  if (batch.recipients.length > ENSEND_BROADCAST_BATCH_SIZE) {
    throw new Error(`A broadcast batch can have at most ${ENSEND_BROADCAST_BATCH_SIZE} recipients`);
  }

  const ensend = getClient();
  if (isEmailRateLimited()) throw new EmailRateLimitError();

  const recipients = batch.recipients.map((recipient) => ({
    address: recipient.address,
    ...(cleanName(recipient.name) ? { name: cleanName(recipient.name) } : {}),
    variables: recipient.variables
  }));

  const result = batch.broadcastRef
    ? await ensend.SendApi.SendExistingMailBroadcast({ broadcastRef: batch.broadcastRef, recipients })
    : await ensend.SendApi.SendMailBroadcast({
        subject: batch.subject,
        message: batch.html,
        sender: senderIdentity(batch.fromName),
        recipients,
        ...(batch.replyTo ? { replyAddress: batch.replyTo } : {})
      });

  const payload = unwrap(result as EnsendResult);
  const ref = (payload.broadcast as { ref?: unknown } | undefined)?.ref ?? payload.ref ?? batch.broadcastRef;
  if (typeof ref !== 'string' || !ref) {
    throw new EnsendApiError(502, 'Broadcast accepted but no broadcast ref was returned');
  }
  return ref;
};

/* ---- Merge tags → Ensend variables ---- */

const MERGE_TAG = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type Slot = { name: string; key: string; fallback?: string; html: boolean };

export interface EnsendTemplate {
  subject: string;
  html: string;
  /** Variables for one recipient, from that recipient's merge values */
  variablesFor: (values: Record<string, string>) => Record<string, string>;
}

/**
 * Rewrite merge tags as Ensend placeholders. Every distinct tag (key + fallback,
 * subject vs body) gets its own variable so fallbacks and HTML escaping are
 * applied per recipient on our side, exactly as renderEmail would.
 */
export const toEnsendTemplate = (subject: string, html: string): EnsendTemplate => {
  const slots = new Map<string, Slot>();
  let fallbackCounter = 0;

  const rewrite = (input: string, isHtml: boolean): string =>
    input.replace(MERGE_TAG, (_match, key: string, fallback?: string) => {
      const id = `${isHtml ? 'b' : 's'}|${key}|${fallback ?? ''}`;
      let slot = slots.get(id);
      if (!slot) {
        let name = `${isHtml ? '' : 'subject_'}${key.replace(/\./g, '_')}`;
        if (fallback !== undefined) name += `_or_${++fallbackCounter}`;
        slot = { name, key, fallback, html: isHtml };
        slots.set(id, slot);
      }
      return `{{${slot.name}}}`;
    });

  const ensendSubject = rewrite(subject, false);
  const ensendHtml = rewrite(html, true);
  const allSlots = [...slots.values()];

  return {
    subject: ensendSubject,
    html: ensendHtml,
    variablesFor: (values) =>
      Object.fromEntries(
        allSlots.map((slot) => {
          const value = values[slot.key] ?? slot.fallback ?? '';
          return [slot.name, slot.html ? escapeHtml(value) : value];
        })
      )
  };
};
