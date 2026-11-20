import mongoose from 'mongoose';
import { Contact } from '../models/Contact';
import { logger } from '../config/logger';

type CompanyLike = {
  _id: unknown;
  organization_id: unknown;
  contact_person?: string | null;
  email?: string | null;
  phone?: string | null;
  owner_id?: unknown;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectId = (value: unknown): mongoose.Types.ObjectId | undefined => {
  if (!value) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return toObjectId((value as { _id: unknown })._id);
  }
  return mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : undefined;
};

/**
 * A company's `contact_person` is free text. Make sure it also exists as a
 * Contact linked to the company so it shows in the Contacts module and the
 * company's contact list. Idempotent: reuses a matching contact instead of
 * creating a duplicate. Never throws — a sync failure must not fail the
 * company save.
 */
export const syncCompanyContactPerson = async (company: CompanyLike): Promise<void> => {
  try {
    const fullName = company.contact_person?.trim().replace(/\s+/g, ' ');
    const companyId = toObjectId(company._id);
    const organizationId = toObjectId(company.organization_id);
    if (!fullName || !companyId || !organizationId) return;

    const [firstName, ...rest] = fullName.split(' ');
    const lastName = rest.join(' ');

    const sameName = await Contact.exists({
      organization_id: organizationId,
      company_id: companyId,
      first_name: { $regex: `^${escapeRegex(firstName)}$`, $options: 'i' },
      last_name: { $regex: `^${escapeRegex(lastName)}$`, $options: 'i' }
    });
    if (sameName) return;

    const email = company.email?.trim().toLowerCase() || undefined;
    if (email) {
      const byEmail = await Contact.findOne({ organization_id: organizationId, email }).select('company_id');
      if (byEmail) {
        if (!byEmail.company_id) {
          byEmail.company_id = companyId;
          await byEmail.save();
        }
        return;
      }
    }

    await Contact.create({
      first_name: firstName,
      last_name: lastName,
      email,
      phone: company.phone?.trim() || undefined,
      company_id: companyId,
      owner_id: toObjectId(company.owner_id),
      organization_id: organizationId
    });
  } catch (error) {
    logger.error({ err: error, companyId: String(company._id) }, 'Failed to sync company contact person');
  }
};
