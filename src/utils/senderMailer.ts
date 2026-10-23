/**
 * Send a single email through Sender.net's transactional API.
 * Used by broadcasts and email triggers (system mail still goes through Ensend).
 * https://api.sender.net/transactional-campaigns/send-transactional/
 */
import config from '../config';

const SENDER_SEND_URL = 'https://api.sender.net/v2/message/send';
/** Used when a 429 comes back without a Retry-After header */
const DEFAULT_BACKOFF_MS = 60_000;

export interface OutboundEmail {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  /** Sender display name — defaults to SENDER_FROM_NAME */
  fromName?: string;
  replyTo?: string;
  /** One-click unsubscribe URL, sent as List-Unsubscribe (RFC 8058) */
  unsubscribeUrl?: string;
}

/** Sender.net answered 429 — nothing was sent, so the email can be retried later */
export class SenderRateLimitError extends Error {
  constructor(message = 'Sender.net rate limit reached') {
    super(message);
    this.name = 'SenderRateLimitError';
  }
}

let rateLimitedUntil = 0;

export const isSenderConfigured = (): boolean => Boolean(config.SENDER_API_TOKEN && config.SENDER_FROM_EMAIL);

/** True while backing off after a 429 */
export const isSenderRateLimited = (): boolean => Date.now() < rateLimitedUntil;

const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BACKOFF_MS;
};

/** Strip characters that would break a header value */
const cleanName = (name: string | undefined): string | undefined => name?.replace(/["\r\n\\]/g, '').trim() || undefined;

export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Returns Sender's email id */
export const sendEmail = async (email: OutboundEmail): Promise<string> => {
  if (!isSenderConfigured()) {
    throw new Error('Sender.net is not configured — set SENDER_API_TOKEN and SENDER_FROM_EMAIL');
  }
  if (isSenderRateLimited()) throw new SenderRateLimitError();

  const headers: Record<string, string> = {};
  if (email.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${email.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  if (email.replyTo) headers['Reply-To'] = email.replyTo;

  const response = await fetch(SENDER_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.SENDER_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      from: { email: config.SENDER_FROM_EMAIL, name: cleanName(email.fromName ?? config.SENDER_FROM_NAME) ?? config.SENDER_FROM_EMAIL },
      to: { email: email.to, name: cleanName(email.toName) },
      subject: email.subject,
      html: email.html,
      text: htmlToText(email.html),
      headers: Object.keys(headers).length ? headers : undefined
    })
  });

  if (response.status === 429) {
    rateLimitedUntil = Date.now() + retryAfterMs(response.headers.get('retry-after'));
    throw new SenderRateLimitError();
  }

  const body = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; emailId?: string };
  if (!response.ok || body.success === false) {
    throw new Error(`Sender.net ${response.status}: ${body.message ?? response.statusText}`);
  }

  return body.emailId ?? '';
};
