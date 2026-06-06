/**
 * Contact management controller
 * Handles CRUD operations for contacts and related data
 */
import { Response } from 'express';
import mongoose from 'mongoose';
import { Contact, IContact, Temperature } from '../models/Contact';
import { Activity } from '../models/Activity';
import { Deal } from '../models/Deal';
import { Task } from '../models/Task';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';

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

type CsvContactRow = Partial<Record<keyof CreateContactBody, string>>;

const CONTACT_CSV_HEADER_ALIASES: Record<string, keyof CreateContactBody> = {
  role: 'role_title'
};

const parseCsv = (csv: string): CsvContactRow[] => {
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

  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  return rows.slice(1).map((values) =>
    headers.reduce<CsvContactRow>((contact, header, index) => {
      if (header) {
        const field = CONTACT_CSV_HEADER_ALIASES[header] || (header as keyof CreateContactBody);
        contact[field] = values[index]?.trim() || '';
      }
      return contact;
    }, {})
  );
};

const parseTags = (tags?: string): string[] => {
  if (!tags) return [];
  return tags
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const parseTemperature = (temperature?: string): Temperature => {
  return temperature === 'hot' || temperature === 'cold' || temperature === 'warm' ? temperature : 'warm';
};

/**
 * Bulk import contacts
 * Imports multiple contacts at once
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

    const contacts = parseCsv(req.file.buffer.toString('utf8'));

    if (contacts.length === 0) {
      res.status(400).json({
        status: false,
        message: 'CSV file must include a header row and at least one contact row'
      });
      return;
    }

    const errors: string[] = [];
    const validContacts: Record<string, unknown>[] = [];

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      if (!contact.first_name || !contact.last_name) {
        errors.push(`Row ${i + 1}: first_name and last_name are required`);
        continue;
      }

      if (contact.company_id && !mongoose.Types.ObjectId.isValid(contact.company_id)) {
        errors.push(`Row ${i + 1}: company_id is invalid`);
        continue;
      }

      validContacts.push({
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone,
        role_title: contact.role_title,
        company_id: contact.company_id ? new mongoose.Types.ObjectId(contact.company_id) : undefined,
        temperature: parseTemperature(contact.temperature),
        tags: parseTags(contact.tags),
        owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
        organization_id: organizationId
      });
    }

    let imported = 0;
    if (validContacts.length > 0) {
      const result = await Contact.insertMany(validContacts);
      imported = result.length;
    }

    res.json({
      status: true,
      message: 'Contacts imported successfully',
      data: { imported, errors: errors.length > 0 ? errors : undefined }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to import contacts'
    });
  }
};
