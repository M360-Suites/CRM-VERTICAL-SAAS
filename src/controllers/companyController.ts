import { Response } from 'express';
import mongoose from 'mongoose';
import { Company, ICompany } from '../models/Company';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';

interface CompanyQuery {
  page?: number;
  limit?: number;
  search?: string;
  owner_id?: string;
  industry?: string;
}

type CompanyStats = {
  contact_count: number;
  deal_count: number;
  pipeline_value: number;
  won_revenue: number;
};

const emptyStats = (): CompanyStats => ({
  contact_count: 0,
  deal_count: 0,
  pipeline_value: 0,
  won_revenue: 0
});

const getCompanyStatsMap = async (
  companyIds: mongoose.Types.ObjectId[],
  organizationId: mongoose.Types.ObjectId
): Promise<Map<string, CompanyStats>> => {
  if (companyIds.length === 0) return new Map();

  const [contactStats, dealStats] = await Promise.all([
    Contact.aggregate([
      { $match: { organization_id: organizationId, company_id: { $in: companyIds } } },
      { $group: { _id: '$company_id', contact_count: { $sum: 1 } } }
    ]),
    Deal.aggregate([
      { $match: { organization_id: organizationId, company_id: { $in: companyIds } } },
      {
        $group: {
          _id: '$company_id',
          deal_count: { $sum: 1 },
          pipeline_value: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, { $ifNull: ['$value', 0] }, 0] } },
          won_revenue: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, { $ifNull: ['$value', 0] }, 0] } }
        }
      }
    ])
  ]);

  const statsMap = new Map<string, CompanyStats>();

  companyIds.forEach((companyId) => {
    statsMap.set(companyId.toString(), emptyStats());
  });

  contactStats.forEach((stat) => {
    const key = stat._id.toString();
    const current = statsMap.get(key) || emptyStats();
    current.contact_count = stat.contact_count;
    statsMap.set(key, current);
  });

  dealStats.forEach((stat) => {
    const key = stat._id.toString();
    const current = statsMap.get(key) || emptyStats();
    current.deal_count = stat.deal_count;
    current.pipeline_value = stat.pipeline_value;
    current.won_revenue = stat.won_revenue;
    statsMap.set(key, current);
  });

  return statsMap;
};

const attachCompanyStats = async <T extends { _id: unknown }>(
  companies: T[],
  organizationId: mongoose.Types.ObjectId
) => {
  const companyIds = companies
    .map((company) => company._id)
    .filter((id): id is mongoose.Types.ObjectId => id instanceof mongoose.Types.ObjectId);
  const statsMap = await getCompanyStatsMap(companyIds, organizationId);

  return companies.map((company) => ({
    ...company,
    stats: statsMap.get(String(company._id)) || emptyStats()
  }));
};

export const listCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search, owner_id, industry } = req.query as CompanyQuery;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { industry: { $regex: search, $options: 'i' } },
        { website: { $regex: search, $options: 'i' } }
      ];
    }

    if (owner_id) query.owner_id = new mongoose.Types.ObjectId(owner_id);
    if (industry) query.industry = industry;

    const skip = (page - 1) * limit;

    const [companies, total] = await Promise.all([
      Company.find(query)
        .populate('owner_id', 'email display_name')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Company.countDocuments(query)
    ]);

    const companiesWithStats = await attachCompanyStats(companies, organizationId);

    const response: PaginatedResponse<ICompany> = {
      status: true,
      message: 'Companies retrieved successfully',
      data: {
        data: companiesWithStats as unknown as ICompany[],
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
      message: 'Failed to fetch companies'
    });
  }
};

export const getCompanyById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const company = await Company.findOne({ _id: id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .lean();

    if (!company) {
      res.status(404).json({
        status: false,
        message: 'Company not found'
      });
      return;
    }

    const [companyWithStats] = await attachCompanyStats([company], organizationId);

    res.json({ status: true, message: 'Company retrieved successfully', data: companyWithStats });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch company'
    });
  }
};

interface CreateCompanyBody {
  name: string;
  industry?: string;
  website?: string;
  notes?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
}

type CsvCompanyRow = Partial<Record<keyof CreateCompanyBody, string>>;

const parseCsv = (csv: string): CsvCompanyRow[] => {
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
    headers.reduce<CsvCompanyRow>((company, header, index) => {
      if (header) {
        company[header as keyof CreateCompanyBody] = values[index]?.trim() || '';
      }
      return company;
    }, {})
  );
};

export const createCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, industry, website, notes, contact_person, email, phone, address } = req.body as CreateCompanyBody;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const company = new Company({
      name,
      industry,
      website,
      notes,
      contact_person,
      email,
      phone,
      address,
      owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      organization_id: organizationId
    });

    await company.save();

    const populatedCompany = await Company.findOne({ _id: company._id, organization_id: organizationId })
      .populate('owner_id', 'email display_name');

    const [companyWithStats] = populatedCompany
      ? await attachCompanyStats([populatedCompany.toObject ? populatedCompany.toObject() : populatedCompany], organizationId)
      : [populatedCompany];

    res.status(201).json({ status: true, message: 'Company created successfully', data: companyWithStats });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to create company'
    });
  }
};

export const bulkImportCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const companies = parseCsv(req.file.buffer.toString('utf8'));

    if (companies.length === 0) {
      res.status(400).json({
        status: false,
        message: 'CSV file must include a header row and at least one company row'
      });
      return;
    }

    const errors: string[] = [];
    const validCompanies: Record<string, unknown>[] = [];

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      if (!company.name) {
        errors.push(`Row ${i + 1}: name is required`);
        continue;
      }

      validCompanies.push({
        name: company.name,
        industry: company.industry,
        website: company.website,
        notes: company.notes,
        contact_person: company.contact_person,
        email: company.email,
        phone: company.phone,
        address: company.address,
        owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
        organization_id: organizationId
      });
    }

    let imported = 0;
    if (validCompanies.length > 0) {
      const result = await Company.insertMany(validCompanies);
      imported = result.length;
    }

    res.json({
      status: true,
      message: 'Companies imported successfully',
      data: { imported, errors: errors.length > 0 ? errors : undefined }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to import companies'
    });
  }
};

interface UpdateCompanyBody {
  name?: string;
  industry?: string;
  website?: string;
  notes?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export const updateCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const updateData = req.body as UpdateCompanyBody;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const company = await Company.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('owner_id', 'email display_name');

    if (!company) {
      res.status(404).json({
        status: false,
        message: 'Company not found'
      });
      return;
    }

    const [companyWithStats] = await attachCompanyStats([company.toObject ? company.toObject() : company], organizationId);

    res.json({ status: true, message: 'Company updated successfully', data: companyWithStats });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update company'
    });
  }
};

export const deleteCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const company = await Company.findOneAndDelete({ _id: id, organization_id: organizationId });

    if (!company) {
      res.status(404).json({
        status: false,
        message: 'Company not found'
      });
      return;
    }

    res.json({ status: true, message: 'Company deleted successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to delete company'
    });
  }
};

export const getCompanyContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const contacts = await Contact.find({ company_id: id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({ status: true, message: 'Company contacts retrieved successfully', data: contacts });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch company contacts'
    });
  }
};

export const getCompanyDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deals = await Deal.find({ company_id: id, organization_id: organizationId })
      .populate('stage_id', 'name')
      .populate('contact_id', 'first_name last_name')
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({ status: true, message: 'Company deals retrieved successfully', data: deals });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch company deals'
    });
  }
};

export const getCompanyStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid company ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const statsMap = await getCompanyStatsMap([new mongoose.Types.ObjectId(id)], organizationId);
    const stats = statsMap.get(id) || emptyStats();

    res.json({
      status: true,
      message: 'Company stats retrieved successfully',
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch company stats'
    });
  }
};

export const exportCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { format = 'csv' } = req.query;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const companies = await Company.find({ organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="companies.json"');
      res.json({ status: true, message: 'Companies exported successfully', data: companies });
      return;
    }

    const headers = [
      'name',
      'industry',
      'website',
      'email',
      'phone',
      'address',
      'contact_person',
      'notes',
      'owner_email',
      'owner_name',
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

    const rows = companies.map((company) =>
      [
        escapeCSV(company.name),
        escapeCSV(company.industry),
        escapeCSV(company.website),
        escapeCSV(company.email),
        escapeCSV(company.phone),
        escapeCSV(company.address),
        escapeCSV(company.contact_person),
        escapeCSV(company.notes),
        escapeCSV((company.owner_id as unknown as { email?: string })?.email),
        escapeCSV((company.owner_id as unknown as { display_name?: string })?.display_name),
        escapeCSV(company.created_at)
      ].join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="companies.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to export companies'
    });
  }
};
