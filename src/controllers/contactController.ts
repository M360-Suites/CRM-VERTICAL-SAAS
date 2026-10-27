/**
 * Contact management controller
 * Handles CRUD operations for contacts and related data
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { Contact, IContact, Temperature } from '../models/Contact';
import { Activity } from '../models/Activity';
import { Company } from '../models/Company';
import { Deal } from '../models/Deal';
import { Task } from '../models/Task';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';
import { isValidEmail, isValidPhone, MAX_IMPORT_ROWS, nameKey, parseImportCsv } from '../utils/csvImport';

/** Query parameters for listing contacts */
interface ContactQuery {
  page?: number;
  limit?: number;
  search?: string;
  company_id?: string;
  owner_id?: string;
  temperature?: Temperature;
  tags?: string;
}

/**
 * List contacts
 * Returns paginated list of contacts with filtering and search
 */
export const listContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      company_id,
      owner_id,
      temperature,
      tags
    } = req.query as ContactQuery;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };

    if (search) {
      query.$or = [
        { first_name: { $regex: search, $options: 'i' } },
        { last_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    if (company_id) query.company_id = new mongoose.Types.ObjectId(company_id);
    if (owner_id) query.owner_id = new mongoose.Types.ObjectId(owner_id);
    if (temperature) query.temperature = temperature;
    if (tags) query.tags = { $in: String(tags).split(',') };

    const skip = (page - 1) * limit;

    const [contacts, total] = await Promise.all([
      Contact.find(query)
        .populate('company_id', 'name industry website')
        .populate('owner_id', 'email display_name')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Contact.countDocuments(query)
    ]);

    const response: PaginatedResponse<IContact> = {
      status: true,
      message: 'Contacts retrieved successfully',
      data: {
        data: contacts,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch contacts'
    });
  }
};

/**
 * Get all contacts
 * Returns every contact scoped to the authenticated user's organization
 */
export const getAllContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contacts = await Contact.find({ organization_id: organizationId })
      .populate('company_id', 'name industry website')
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'All contacts retrieved successfully',
      data: contacts
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch all contacts'
    });
  }
};

/**
 * Get contact by ID
 * Returns a single contact by their unique identifier
 */
export const getContactById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contact = await Contact.findOne({ _id: id, organization_id: organizationId })
      .populate('company_id', 'name industry website')
      .populate('owner_id', 'email display_name')
      .lean();

    if (!contact) {
      res.status(404).json({
        status: false,
        message: 'Contact not found'
      });
      return;
    }

    res.json({ status: true, message: 'Contact retrieved successfully', data: contact });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch contact'
    });
  }
};

/** Request body for creating contact */
interface CreateContactBody {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  role_title?: string;
  company_id?: string;
  temperature?: Temperature;
  tags?: string[];
}

/**
 * Create new contact
 * Creates a new contact with provided data
 */
export const createContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      role_title,
      company_id,
      temperature,
      tags
    } = req.body as CreateContactBody;

    if (!first_name || !last_name) {
      res.status(400).json({
        status: false,
        message: 'first_name and last_name are required'
      });
      return;
    }

    if (company_id && !mongoose.Types.ObjectId.isValid(company_id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contact = new Contact({
      first_name,
      last_name,
      email,
      phone,
      role_title,
      company_id: company_id ? new mongoose.Types.ObjectId(company_id) : undefined,
      temperature: temperature || 'warm',
      tags: tags || [],
      owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      organization_id: organizationId
    });

    await contact.save();

    const populatedContact = await Contact.findOne({ _id: contact._id, organization_id: organizationId })
      .populate('company_id', 'name industry website')
      .populate('owner_id', 'email display_name');

    res.status(201).json({ status: true, message: 'Contact created successfully', data: populatedContact });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      res.status(400).json({
        status: false,
        message: error.message
      });
      return;
    }

    res.status(500).json({
      status: false,
      message: 'Failed to create contact'
    });
  }
};

/** Request body for updating contact */
interface UpdateContactBody {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  role_title?: string;
  company_id?: string;
  temperature?: Temperature;
  tags?: string[];
  last_contacted_at?: string;
}

/**
 * Update contact
 * Updates an existing contact with provided data
 */
export const updateContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const updateData = req.body as UpdateContactBody;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const updateObj: Record<string, unknown> = { ...updateData };

    if (updateData.company_id) {
      updateObj.company_id = new mongoose.Types.ObjectId(updateData.company_id);
    } else if (updateData.company_id === null) {
      updateObj.company_id = null;
    }

    if (updateData.last_contacted_at) {
      updateObj.last_contacted_at = new Date(updateData.last_contacted_at);
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contact = await Contact.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: updateObj },
      { new: true, runValidators: true }
    )
      .populate('company_id', 'name industry website')
      .populate('owner_id', 'email display_name');

    if (!contact) {
      res.status(404).json({
        status: false,
        message: 'Contact not found'
      });
      return;
    }

    res.json({ status: true, message: 'Contact updated successfully', data: contact });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update contact'
    });
  }
};

/**
 * Delete contact
 * Permanently removes a contact from the system
 */
export const deleteContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contact = await Contact.findOneAndDelete({ _id: id, organization_id: organizationId });

    if (!contact) {
      res.status(404).json({
        status: false,
        message: 'Contact not found'
      });
      return;
    }

    res.json({ status: true, message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to delete contact'
    });
  }
};

/**
 * Get contact activities
 * Returns all activities associated with a contact
 */
export const getContactActivities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const activities = await Activity.find({ contact_id: id, organization_id: organizationId })
      .populate('user_id', 'email display_name')
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    res.json({ status: true, message: 'Activities retrieved successfully', data: activities });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch activities'
    });
  }
};

/**
 * Get contact deals
 * Returns all deals associated with a contact
 */
export const getContactDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deals = await Deal.find({ contact_id: id, organization_id: organizationId })
      .populate('stage_id', 'name')
      .populate('company_id', 'name')
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({ status: true, message: 'Deals retrieved successfully', data: deals });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch deals'
    });
  }
};

/**
 * Get contact tasks
 * Returns all tasks associated with a contact
 */
export const getContactTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid contact ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const tasks = await Task.find({ contact_id: id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('deal_id', 'title')
      .sort({ due_at: 1 })
      .lean();

    res.json({ status: true, message: 'Tasks retrieved successfully', data: tasks });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tasks'
    });
  }
};

/**
 * Export contacts as CSV
 * Returns contacts in CSV format for spreadsheet import/export
 */
export const exportContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { format = 'csv' } = req.query;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contacts = await Contact.find({ organization_id: organizationId })
      .populate('company_id', 'name industry website')
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="contacts.json"');
      res.json({ status: true, message: 'Contacts exported successfully', data: contacts });
      return;
    }

    const headers = [
      'first_name',
      'last_name',
      'email',
      'phone',
      'role_title',
      'company',
      'industry',
      'website',
      'temperature',
      'tags',
      'owner_email',
      'owner_name',
      'last_contacted_at',
      'created_at'
    ];

    const escapeCSV = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = contacts.map((contact) =>
      [
        escapeCSV(contact.first_name),
        escapeCSV(contact.last_name),
        escapeCSV(contact.email),
        escapeCSV(contact.phone),
        escapeCSV(contact.role_title),
        escapeCSV((contact.company_id as unknown as { name?: string })?.name),
        escapeCSV((contact.company_id as unknown as { industry?: string })?.industry),
        escapeCSV((contact.company_id as unknown as { website?: string })?.website),
        escapeCSV(contact.temperature),
        escapeCSV(contact.tags?.join(';')),
        escapeCSV((contact.owner_id as unknown as { email?: string })?.email),
        escapeCSV((contact.owner_id as unknown as { display_name?: string })?.display_name),
        escapeCSV(contact.last_contacted_at),
        escapeCSV(contact.created_at)
      ].join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to export contacts'
    });
  }
};

/** CSV header (normalized) -> contact field. Unlisted columns become custom fields. */
const CONTACT_CSV_FIELDS: Record<string, string> = {
  name: 'name',
  full_name: 'name',
  contact_name: 'name',
  first_name: 'first_name',
  firstname: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  role_title: 'role_title',
  role: 'role_title',
  job_title: 'role_title',
  company_id: 'company_id',
  company: 'company',
  company_name: 'company',
  temperature: 'temperature',
  tags: 'tags'
};

const parseTags = (tags?: string): string[] => {
  if (!tags) return [];
  return tags
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const parseTemperature = (temperature?: string): Temperature => {
  const value = temperature?.toLowerCase();
  return value === 'hot' || value === 'cold' || value === 'warm' ? value : 'warm';
};

/** A single "name" column is split on the first space: "Ada King Lovelace" -> Ada / King Lovelace */
const splitName = (fields: Record<string, string>): { first_name: string; last_name: string } => {
  if (fields.first_name) return { first_name: fields.first_name, last_name: fields.last_name || '' };
  const [first = '', ...rest] = (fields.name || '').split(/\s+/).filter(Boolean);
  return { first_name: first, last_name: fields.last_name || rest.join(' ') };
};

/**
 * Bulk import contacts from CSV
 * Name (`name`, or `first_name` + optional `last_name`), `email` and `phone` are required.
 * Recognised optional columns: role_title, company_id / company (matched by name), temperature, tags.
 * Every other column is stored in the contact's custom_fields.
 */
export const bulkImportContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    if (!req.file) {
      res.status(400).json({
        status: false,
        message: 'CSV file is required'
      });
      return;
    }

    const { rows, custom_columns } = parseImportCsv(req.file.buffer.toString('utf8'), CONTACT_CSV_FIELDS);

    if (rows.length === 0) {
      res.status(400).json({
        status: false,
        message: 'CSV file must include a header row and at least one contact row'
      });
      return;
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      res.status(400).json({
        status: false,
        message: `CSV file can contain at most ${MAX_IMPORT_ROWS} contact rows`
      });
      return;
    }

    // Resolve company references in two queries instead of one per row
    const companyIds = [...new Set(rows.map(({ fields }) => fields.company_id).filter((id) => id && mongoose.Types.ObjectId.isValid(id)))];
    const companyNames = [...new Set(rows.map(({ fields }) => fields.company).filter(Boolean))];
    const [companiesById, companiesByName] = await Promise.all([
      companyIds.length
        ? Company.find({ _id: { $in: companyIds }, organization_id: organizationId }).select('_id').lean()
        : Promise.resolve([]),
      companyNames.length
        ? Company.find({ name: { $in: companyNames }, organization_id: organizationId })
            .collation({ locale: 'en', strength: 2 })
            .select('_id name')
            .lean()
        : Promise.resolve([])
    ]);
    const knownCompanyIds = new Set(companiesById.map((company) => company._id.toString()));
    const companyIdByName = new Map(companiesByName.map((company) => [nameKey(company.name), company._id]));

    const errors: string[] = [];
    const validContacts: Record<string, unknown>[] = [];

    rows.forEach(({ fields, custom_fields }, i) => {
      const row = `Row ${i + 1}`;
      const { first_name, last_name } = splitName(fields);
      const missing = [!first_name && 'name', !fields.email && 'email', !fields.phone && 'phone'].filter(Boolean);

      if (missing.length > 0) {
        errors.push(`${row}: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} required`);
        return;
      }

      if (!isValidEmail(fields.email)) {
        errors.push(`${row}: email is invalid`);
        return;
      }

      if (!isValidPhone(fields.phone)) {
        errors.push(`${row}: phone is invalid`);
        return;
      }

      let companyId: mongoose.Types.ObjectId | undefined;
      if (fields.company_id) {
        if (!mongoose.Types.ObjectId.isValid(fields.company_id) || !knownCompanyIds.has(fields.company_id)) {
          errors.push(`${row}: company_id is invalid`);
          return;
        }
        companyId = new mongoose.Types.ObjectId(fields.company_id);
      } else if (fields.company) {
        companyId = companyIdByName.get(nameKey(fields.company));
      }

      validContacts.push({
        first_name,
        last_name,
        email: fields.email.toLowerCase(),
        phone: fields.phone,
        role_title: fields.role_title || undefined,
        company_id: companyId,
        temperature: parseTemperature(fields.temperature),
        tags: parseTags(fields.tags),
        // An unmatched company name is kept rather than dropped
        custom_fields: !companyId && fields.company ? { company: fields.company, ...custom_fields } : custom_fields,
        owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
        organization_id: organizationId
      });
    });

    let imported = 0;
    if (validContacts.length > 0) {
      const result = await Contact.insertMany(validContacts);
      imported = result.length;
    }

    res.json({
      status: true,
      message: 'Contacts imported successfully',
      data: {
        imported,
        failed: errors.length,
        custom_columns,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to import contacts'
    });
  }
};
