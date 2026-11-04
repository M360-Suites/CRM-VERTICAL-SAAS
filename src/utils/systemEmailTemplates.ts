/**
 * CRM360 system email templates (verification codes, welcome, notifications, new lead).
 *
 * Templates live in /emails/templates/<name>/ as template.html, template.txt and
 * subject.txt; their images live in /emails/assets and are served at /email-assets.
 * They use a small Handlebars subset, rendered here:
 *   {{var}}                  HTML-escaped value (dotted paths allowed)
 *   {{{var}}}                raw value — trusted HTML only
 *   {{#each list}}…{{/each}} loop; inside, names resolve on the item first, then outer data
 *   {{#if var}}…{{else}}…{{/if}}
 */
import fs from 'fs';
import path from 'path';
import config from '../config';
import { getFrontendUrl } from './frontend';

export type SystemEmailName = 'verify-email' | 'reset-password' | 'staff-otp' | 'welcome' | 'notification' | 'new-lead';

type Data = Record<string, unknown>;

type Node =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string; raw: boolean }
  | { type: 'each'; name: string; body: Node[] }
  | { type: 'if'; name: string; then: Node[]; otherwise: Node[] };

const TAG = /\{\{(\{)?\s*([#/]?)\s*([\w.]+)(?:\s+([\w.]+))?\s*\}?\}\}/g;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Parse a template into a tree; throws on unbalanced blocks so broken templates fail loudly */
export const parseTemplate = (source: string): Node[] => {
  const root: Node[] = [];
  const stack: Array<{ node: Extract<Node, { type: 'each' | 'if' }>; target: Node[] }> = [];
  let current = root;
  let last = 0;

  for (const match of source.matchAll(TAG)) {
    const [whole, raw, sigil, word, arg] = match;
    const index = match.index ?? 0;
    if (index > last) current.push({ type: 'text', value: source.slice(last, index) });
    last = index + whole.length;

    if (sigil === '#') {
      if ((word !== 'each' && word !== 'if') || !arg) throw new Error(`Unsupported block tag: ${whole}`);
      const node: Extract<Node, { type: 'each' | 'if' }> =
        word === 'each' ? { type: 'each', name: arg, body: [] } : { type: 'if', name: arg, then: [], otherwise: [] };
      current.push(node);
      stack.push({ node, target: current });
      current = node.type === 'each' ? node.body : node.then;
    } else if (sigil === '/') {
      const open = stack.pop();
      if (!open || open.node.type !== word) throw new Error(`Unexpected closing tag: ${whole}`);
      current = open.target;
    } else if (word === 'else' && !raw) {
      const open = stack[stack.length - 1];
      if (!open || open.node.type !== 'if') throw new Error('{{else}} outside of {{#if}}');
      current = open.node.otherwise;
    } else {
      current.push({ type: 'var', name: word, raw: Boolean(raw) });
    }
  }

  if (stack.length) throw new Error(`Unclosed block: {{#${stack[stack.length - 1].node.type}}}`);
  if (last < source.length) root.push({ type: 'text', value: source.slice(last) });
  return root;
};

const lookup = (scopes: Data[], name: string): unknown => {
  for (let i = scopes.length - 1; i >= 0; i--) {
    let value: unknown = scopes[i];
    let found = true;
    for (const part of name.split('.')) {
      if (value !== null && typeof value === 'object' && part in (value as Data)) {
        value = (value as Data)[part];
      } else {
        found = false;
        break;
      }
    }
    if (found) return value;
  }
  return undefined;
};

const isTruthy = (value: unknown): boolean => (Array.isArray(value) ? value.length > 0 : Boolean(value));

const renderNodes = (nodes: Node[], scopes: Data[], escape: boolean): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'var': {
          const value = lookup(scopes, node.name);
          const text = value === undefined || value === null ? '' : String(value);
          return node.raw || !escape ? text : escapeHtml(text);
        }
        case 'each': {
          const list = lookup(scopes, node.name);
          if (!Array.isArray(list)) return '';
          return list
            .map((item) => renderNodes(node.body, [...scopes, (item ?? {}) as Data], escape))
            .join('');
        }
        case 'if':
          return renderNodes(isTruthy(lookup(scopes, node.name)) ? node.then : node.otherwise, scopes, escape);
      }
    })
    .join('');

/** Render a template string. `escape: false` for subjects and plain text. */
export const renderTemplateString = (source: string, data: Data, options: { escape: boolean } = { escape: true }): string =>
  renderNodes(parseTemplate(source), [data], options.escape);

/* ---- Loading ---- */

const candidateRoots = (): string[] => [
  path.resolve(process.cwd(), 'emails'),
  path.resolve(__dirname, '..', '..', 'emails'), // ts-node / jest: src/utils
  path.resolve(__dirname, '..', '..', '..', 'emails') // compiled: dist/src/utils
];

let emailsRoot: string | undefined;

export const getEmailsRoot = (): string => {
  if (emailsRoot) return emailsRoot;
  const found = candidateRoots().find((dir) => fs.existsSync(path.join(dir, 'templates')));
  if (!found) throw new Error(`Email templates folder not found (looked in: ${candidateRoots().join(', ')})`);
  emailsRoot = found;
  return found;
};

/** Directory served at /email-assets */
export const getEmailAssetsDir = (): string => path.join(getEmailsRoot(), 'assets');

type LoadedTemplate = { subject: string; html: string; text: string };
const cache = new Map<SystemEmailName, LoadedTemplate>();

const loadTemplate = (name: SystemEmailName): LoadedTemplate => {
  const cached = cache.get(name);
  if (cached) return cached;

  const dir = path.join(getEmailsRoot(), 'templates', name);
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  const template = {
    subject: read('subject.txt').trim(),
    html: read('template.html'),
    text: read('template.txt')
  };
  cache.set(name, template);
  return template;
};

/* ---- Shared values ---- */

/** Public base URL for template images — EMAIL_ASSETS_BASE_URL (e.g. a CDN), else this API's /email-assets */
export const getEmailAssetsBaseUrl = (): string => {
  const explicit = config.EMAIL_ASSETS_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  if (config.BACKEND_URL) return `${config.BACKEND_URL.replace(/\/+$/, '')}/email-assets`;
  return '';
};

export const getSupportUrl = (): string => config.SUPPORT_URL?.trim() || getFrontendUrl();

export interface RenderedSystemEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render a system email. `assets_base_url` and `support_url` are filled in
 * automatically; pass anything else the template needs.
 */
export const renderSystemEmail = (name: SystemEmailName, data: Data): RenderedSystemEmail => {
  const template = loadTemplate(name);
  const values: Data = {
    assets_base_url: getEmailAssetsBaseUrl(),
    support_url: getSupportUrl(),
    ...data
  };

  return {
    subject: renderTemplateString(template.subject, values, { escape: false }).replace(/\s+/g, ' ').trim(),
    html: renderTemplateString(template.html, values, { escape: true }),
    text: renderTemplateString(template.text, values, { escape: false })
  };
};
