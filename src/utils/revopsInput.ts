import mongoose from 'mongoose';

/**
 * Small input parsers for the Revenue Engine endpoints. Each returns undefined
 * for missing input and null for present-but-invalid input, so handlers can
 * tell "not sent" from "bad value".
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const optionalString = (value: unknown, maxLength = 200): string | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? null : trimmed;
};

export const optionalNumber = (value: unknown, min: number, max: number): number | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
};

export const optionalEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
};

export const optionalObjectId = (value: unknown): mongoose.Types.ObjectId | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
};

export const optionalDate = (value: unknown): string | undefined | null => {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
};

export const parsePaging = (query: Record<string, unknown>, defaultLimit = 50, maxLimit = 200) => {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit)) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};
