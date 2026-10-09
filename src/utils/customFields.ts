/**
 * Custom field extraction for public lead capture.
 * Collects a form's `customFields` / `custom_fields` object plus any top-level
 * keys the endpoint doesn't otherwise understand, so no submitted data is lost.
 */

export type CustomFields = Record<string, unknown>;

const MAX_FIELDS = 50;
const MAX_KEY_LENGTH = 100;
const MAX_STRING_LENGTH = 5000;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 3;

const CUSTOM_FIELD_CONTAINERS = ['customFields', 'custom_fields'];

/** Mongo-unsafe or prototype-polluting keys are dropped */
const isSafeKey = (key: string): boolean =>
  key.length > 0 &&
  key.length <= MAX_KEY_LENGTH &&
  !key.startsWith('$') &&
  !key.includes('.') &&
  key !== '__proto__' &&
  key !== 'constructor' &&
  key !== 'prototype';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed.slice(0, MAX_STRING_LENGTH);
  }
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const out: CustomFields = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_FIELDS)) {
      if (!isSafeKey(key)) continue;
      const clean = sanitizeValue(nested, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
};

/**
 * @param body - raw request body
 * @param knownKeys - top-level keys already mapped to first-class fields
 */
export const extractCustomFields = (body: unknown, knownKeys: Iterable<string>): CustomFields => {
  if (!isPlainObject(body)) return {};

  const known = new Set([...knownKeys, ...CUSTOM_FIELD_CONTAINERS]);
  const result: CustomFields = {};

  const add = (key: string, value: unknown) => {
    if (Object.keys(result).length >= MAX_FIELDS || !isSafeKey(key)) return;
    const clean = sanitizeValue(value, 0);
    if (clean !== undefined) result[key] = clean;
  };

  // Unrecognised top-level keys first, so an explicit customFields entry wins on collision
  for (const [key, value] of Object.entries(body)) {
    if (!known.has(key)) add(key, value);
  }

  for (const container of CUSTOM_FIELD_CONTAINERS) {
    const nested = body[container];
    if (isPlainObject(nested)) {
      for (const [key, value] of Object.entries(nested)) {
        delete result[key];
        add(key, value);
      }
    }
  }

  return result;
};
