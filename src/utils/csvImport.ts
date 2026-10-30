/**
 * Shared CSV import helpers for contacts, companies and deals.
 * Columns that map to a known field (directly or through an alias) become
 * first-class values; every other column is kept as a custom field so no
 * imported data is lost.
 */
import type { Request } from 'express';
import multer from 'multer';
import { extractCustomFields, type CustomFields } from './customFields';

type MulterOptions = NonNullable<Parameters<typeof multer>[0]>;
type FileFilterCallback = {
  (error: Error): void;
  (error: null, acceptFile: boolean): void;
};

const csvUploadOptions: MulterOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const isCsv =
      file.originalname.toLowerCase().endsWith('.csv') ||
      ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype);

    cb(null, isCsv);
  }
};

/** Multer instance accepting a single in-memory CSV upload (max 5MB) */
export const uploadCsv = multer(csvUploadOptions);

/** Upper bound on data rows per import, keeps a single request bounded */
export const MAX_IMPORT_ROWS = 5000;

export interface ParsedCsvRow {
  /** Values for recognised columns, keyed by canonical field name */
  fields: Record<string, string>;
  /** Values for every other column, keyed by the original header */
  custom_fields: CustomFields;
}

export interface ParsedCsv {
  rows: ParsedCsvRow[];
  /** Original headers that were stored as custom fields */
  custom_columns: string[];
}

/** "First Name" / "first-name" / "FIRST_NAME" all become "first_name" */
export const normalizeHeader = (header: string): string =>
  header
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');

/** Custom field keys keep the header as written, minus characters Mongo rejects in keys */
const toCustomFieldKey = (header: string): string =>
  header.replace(/^﻿/, '').trim().replace(/\./g, '_').replace(/^\$+/, '');

/** Drops scheme-style labels exporters prepend, e.g. Meta Lead Ads "p:+234..." or "tel:+1..." */
export const cleanPhone = (phone: string): string => phone.replace(/^[a-z]+:\s*/i, '');

const parseCsvRows = (csv: string): string[][] => {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(current);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((value) => value.trim() !== '')) rows.push(row);

  return rows;
};

/**
 * Parse a CSV and split each row into known fields and custom fields.
 * @param aliases - normalized header -> canonical field name. Canonical names
 *   map to themselves implicitly, so only list them if they need no alias.
 */
export const parseImportCsv = (csv: string, aliases: Record<string, string>): ParsedCsv => {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return { rows: [], custom_columns: [] };

  const headers = rows[0].map((header) => {
    const normalized = normalizeHeader(header);
    const field = aliases[normalized];
    return field ? { field } : { customKey: toCustomFieldKey(header) };
  });

  const customColumns = headers.flatMap((header) => (header.customKey ? [header.customKey] : []));

  const parsed = rows.slice(1).map((values) => {
    const fields: Record<string, string> = {};
    const custom: Record<string, string> = {};

    headers.forEach((header, index) => {
      const raw = values[index]?.trim() ?? '';
      const value = header.field === 'phone' ? cleanPhone(raw) : raw;
      if (header.field) {
        // When two columns alias to one field, the first non-empty value wins
        if (!fields[header.field]) fields[header.field] = value;
      } else if (header.customKey) {
        custom[header.customKey] = value;
      }
    });

    return { fields, custom_fields: extractCustomFields(custom, []) };
  });

  return {
    rows: parsed,
    custom_columns: [...new Set(customColumns.filter((key) => key !== ''))]
  };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (email: string): boolean => EMAIL_PATTERN.test(email);

/** A phone needs at least 5 digits; formatting characters are allowed */
export const isValidPhone = (phone: string): boolean =>
  /^[+\d\s().\-/x]+$/i.test(phone) && (phone.match(/\d/g)?.length ?? 0) >= 5;

/** Case-insensitive exact-match key used to resolve names against existing records */
export const nameKey = (value: string): string => value.trim().toLowerCase();
