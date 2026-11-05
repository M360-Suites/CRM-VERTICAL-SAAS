/**
 * Duplicate detection for contacts and deals.
 *
 * - Contact: same organization and the same email (case-insensitive) or the same phone.
 * - Deal: same organization, an OPEN deal with the same title (case-insensitive)
 *   linked to the same contact and company. Won/lost deals never block a new one,
 *   so repeat business can still be logged.
 */
import mongoose from 'mongoose';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';

export const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

type Id = mongoose.Types.ObjectId | string;

const clean = (value?: string | null): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

export const emailKey = (email?: string | null): string | undefined => clean(email)?.toLowerCase();
export const phoneKey = (phone?: string | null): string | undefined => clean(phone);
export const titleKey = (title?: string | null): string | undefined => clean(title)?.toLowerCase();

const toId = (id?: Id | null) => (id ? new mongoose.Types.ObjectId(id.toString()) : null);

export interface DuplicateContact {
  _id: mongoose.Types.ObjectId;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  owner_id?: mongoose.Types.ObjectId;
  /** Which field collided */
  matched_on: 'email' | 'phone';
}

/** Finds an existing contact sharing the email or phone, ignoring `excludeId` (the contact being edited) */
export const findDuplicateContact = async (
  organizationId: Id,
  { email, phone }: { email?: string | null; phone?: string | null },
  excludeId?: Id
): Promise<DuplicateContact | null> => {
  const normalizedEmail = emailKey(email);
  const normalizedPhone = phoneKey(phone);
  const or: Record<string, string>[] = [];
  if (normalizedEmail) or.push({ email: normalizedEmail });
  if (normalizedPhone) or.push({ phone: normalizedPhone });
  if (or.length === 0) return null;

  const filter: Record<string, unknown> = { organization_id: organizationId, $or: or };
  if (excludeId) filter._id = { $ne: toId(excludeId) };

  const existing = await Contact.findOne(filter)
    .collation(CASE_INSENSITIVE)
    .select('_id first_name last_name email phone owner_id')
    .lean<Omit<DuplicateContact, 'matched_on'>>();
  if (!existing) return null;

  const matched_on = normalizedEmail && emailKey(existing.email) === normalizedEmail ? 'email' : 'phone';
  return { ...existing, matched_on };
};

/** Lookup sets of emails/phones already used in the org, for bulk imports */
export const loadExistingContactKeys = async (
  organizationId: Id,
  emails: string[],
  phones: string[]
): Promise<{ emails: Set<string>; phones: Set<string> }> => {
  const or: Record<string, unknown>[] = [];
  if (emails.length) or.push({ email: { $in: emails } });
  if (phones.length) or.push({ phone: { $in: phones } });
  if (or.length === 0) return { emails: new Set(), phones: new Set() };

  const existing = await Contact.find({ organization_id: organizationId, $or: or })
    .collation(CASE_INSENSITIVE)
    .select('email phone')
    .lean<{ email?: string; phone?: string }[]>();

  return {
    emails: new Set(existing.map((c) => emailKey(c.email)).filter((v): v is string => !!v)),
    phones: new Set(existing.map((c) => phoneKey(c.phone)).filter((v): v is string => !!v))
  };
};

export interface DuplicateDeal {
  _id: mongoose.Types.ObjectId;
  title: string;
  status: string;
  stage_id?: mongoose.Types.ObjectId;
  contact_id?: mongoose.Types.ObjectId;
  company_id?: mongoose.Types.ObjectId;
}

/** Finds an open deal with the same title for the same contact and company */
export const findDuplicateDeal = async (
  organizationId: Id,
  { title, contact_id, company_id }: { title?: string | null; contact_id?: Id | null; company_id?: Id | null },
  excludeId?: Id
): Promise<DuplicateDeal | null> => {
  const normalizedTitle = clean(title);
  if (!normalizedTitle) return null;

  const filter: Record<string, unknown> = {
    organization_id: organizationId,
    status: 'open',
    title: normalizedTitle,
    // `null` matches both a missing field and an explicit null
    contact_id: toId(contact_id),
    company_id: toId(company_id)
  };
  if (excludeId) filter._id = { $ne: toId(excludeId) };

  return Deal.findOne(filter)
    .collation(CASE_INSENSITIVE)
    .select('_id title status stage_id contact_id company_id')
    .lean<DuplicateDeal>();
};

/** Most recent open deal for a contact (used to avoid opening a second deal for a returning lead) */
export const findOpenDealForContact = async (organizationId: Id, contactId: Id) =>
  Deal.findOne({ organization_id: organizationId, contact_id: toId(contactId), status: 'open' })
    .sort({ created_at: -1 });

export const dealKey = (title?: string | null, contactId?: Id | null, companyId?: Id | null): string =>
  [titleKey(title) ?? '', contactId?.toString() ?? '', companyId?.toString() ?? ''].join('|');

/** Open deal keys already present in the org for the given titles, for bulk imports */
export const loadExistingDealKeys = async (organizationId: Id, titles: string[]): Promise<Set<string>> => {
  if (titles.length === 0) return new Set();
  const existing = await Deal.find({ organization_id: organizationId, status: 'open', title: { $in: titles } })
    .collation(CASE_INSENSITIVE)
    .select('title contact_id company_id')
    .lean<{ title: string; contact_id?: mongoose.Types.ObjectId; company_id?: mongoose.Types.ObjectId }[]>();
  return new Set(existing.map((deal) => dealKey(deal.title, deal.contact_id, deal.company_id)));
};

/** Truthy flag from a JSON body or query string (`true`, `"true"`, `"1"`) */
export const isTruthyFlag = (value: unknown): boolean => value === true || value === 'true' || value === '1';
