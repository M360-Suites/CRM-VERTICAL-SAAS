/**
 * Merge-variable rendering for email templates, triggers and broadcasts.
 *
 * Syntax: {{contact.first_name}} — with an optional fallback: {{contact.first_name | there}}
 * Values are HTML-escaped in bodies; subjects are rendered as plain text.
 */
import crypto from 'crypto';
import config from '../config';

export interface MergeContext {
  contact?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    role_title?: string;
  } | null;
  company?: { name?: string } | null;
  deal?: { title?: string; value?: number; currency?: string } | null;
  stage?: { name?: string } | null;
  owner?: { display_name?: string; email?: string } | null;
  organization?: { name?: string } | null;
  unsubscribe_url?: string;
}

/** Documented for the template canvas's variable picker */
export const MERGE_VARIABLES: Array<{ key: string; label: string; sample: string }> = [
  { key: 'contact.first_name', label: 'Contact first name', sample: 'Ada' },
  { key: 'contact.last_name', label: 'Contact last name', sample: 'Lovelace' },
  { key: 'contact.full_name', label: 'Contact full name', sample: 'Ada Lovelace' },
  { key: 'contact.email', label: 'Contact email', sample: 'ada@example.com' },
  { key: 'contact.phone', label: 'Contact phone', sample: '+1 555 0100' },
  { key: 'contact.role_title', label: 'Contact job title', sample: 'CTO' },
  { key: 'company.name', label: 'Company name', sample: 'Analytical Engines Ltd' },
  { key: 'deal.title', label: 'Deal title', sample: 'Website redesign' },
  { key: 'deal.value', label: 'Deal value', sample: '12,500' },
  { key: 'deal.currency', label: 'Deal currency', sample: 'USD' },
  { key: 'stage.name', label: 'Pipeline stage', sample: 'Proposal' },
  { key: 'owner.name', label: 'Deal owner name', sample: 'Grace Hopper' },
  { key: 'owner.email', label: 'Deal owner email', sample: 'grace@yourcompany.com' },
  { key: 'organization.name', label: 'Your organization', sample: 'Your Company' },
  { key: 'unsubscribe_url', label: 'Unsubscribe link', sample: '#unsubscribe' }
];

export const sampleMergeValues = (): Record<string, string> =>
  Object.fromEntries(MERGE_VARIABLES.map((variable) => [variable.key, variable.sample]));

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Flatten a context into the dotted keys templates reference */
export const buildMergeValues = (ctx: MergeContext): Record<string, string> => {
  const contact = ctx.contact ?? {};
  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const value = ctx.deal?.value;

  const values: Record<string, string | undefined> = {
    'contact.first_name': contact.first_name,
    'contact.last_name': contact.last_name,
    'contact.full_name': fullName || undefined,
    'contact.email': contact.email,
    'contact.phone': contact.phone,
    'contact.role_title': contact.role_title,
    'company.name': ctx.company?.name,
    'deal.title': ctx.deal?.title,
    'deal.value': typeof value === 'number' ? value.toLocaleString('en-US') : undefined,
    'deal.currency': ctx.deal?.currency,
    'stage.name': ctx.stage?.name,
    'owner.name': ctx.owner?.display_name,
    'owner.email': ctx.owner?.email,
    'organization.name': ctx.organization?.name,
    unsubscribe_url: ctx.unsubscribe_url
  };

  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
  );
};

const MERGE_TAG = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export const renderMergeTags = (
  input: string,
  values: Record<string, string>,
  options: { html: boolean }
): string =>
  input.replace(MERGE_TAG, (_match, key: string, fallback?: string) => {
    const value = values[key] ?? fallback ?? '';
    return options.html ? escapeHtml(value) : value;
  });

const usesUnsubscribeTag = (html: string): boolean => /\{\{\s*unsubscribe_url\b/.test(html);

/**
 * Render subject + html for one recipient. When the template has no
 * {{unsubscribe_url}} of its own, a small footer is appended so every
 * automated email carries an opt-out link.
 */
export const renderEmail = (
  template: { subject: string; html: string; preview_text?: string },
  ctx: MergeContext,
  /** Values used where the context has none (e.g. sample data for test sends) */
  fallbackValues: Record<string, string> = {}
): { subject: string; html: string } => {
  const values = { ...fallbackValues, ...buildMergeValues(ctx) };
  let html = template.html;

  if (template.preview_text) {
    const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(template.preview_text)}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (tag) => `${tag}${preheader}`) : preheader + html;
  }

  if (ctx.unsubscribe_url && !usesUnsubscribeTag(html)) {
    const footer =
      '<p style="font-size:12px;color:#888;text-align:center;margin-top:24px">' +
      'Don\'t want these emails? <a href="{{unsubscribe_url}}" style="color:#888">Unsubscribe</a></p>';
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer;
  }

  return {
    subject: renderMergeTags(template.subject, values, { html: false }),
    html: renderMergeTags(html, values, { html: true })
  };
};

/* ---- Unsubscribe tokens ---- */

const unsubscribeSecret = (): string => config.FIELD_ENCRYPTION_KEY || config.JWT_SECRET;

const sign = (payload: string): string =>
  crypto.createHmac('sha256', unsubscribeSecret()).update(`unsubscribe:${payload}`).digest('base64url');

export const createUnsubscribeToken = (contactId: string): string =>
  `${Buffer.from(contactId).toString('base64url')}.${sign(contactId)}`;

/** Returns the contact id, or null when the token is malformed or forged */
export const verifyUnsubscribeToken = (token: string): string | null => {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const contactId = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(sign(contactId));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  return contactId;
};

export const buildUnsubscribeUrl = (contactId: string): string | undefined => {
  if (!config.BACKEND_URL) return undefined;
  const base = config.BACKEND_URL.replace(/\/+$/, '');
  return `${base}/api/v1/public/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(contactId))}`;
};
