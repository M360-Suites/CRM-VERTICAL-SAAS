import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const PIPELINE_ID = '607f1f77bcf86cd799439001';
const LEAD_STAGE_ID = '607f1f77bcf86cd799439002';
const WON_STAGE_ID = '607f1f77bcf86cd799439003';
const COMPANY_ID = '607f1f77bcf86cd799439004';
const CONTACT_ID = '607f1f77bcf86cd799439005';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret' } }));
jest.mock('../src/services/triggerService', () => ({ queueDealTriggers: jest.fn() }));
jest.mock('../src/services/socketService', () => ({ emitNotification: jest.fn(), emitDealStageChanged: jest.fn() }));
jest.mock('../src/services/dealAssignmentService', () => ({ assignDealOwner: jest.fn() }));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = {
      id: '507f1f77bcf86cd799439011',
      organization_id: '507f1f77bcf86cd799439012',
      role: 'admin'
    };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

jest.mock('../src/models/Contact', () => ({ Contact: { find: jest.fn(), insertMany: jest.fn() } }));
jest.mock('../src/models/Company', () => ({ Company: { find: jest.fn(), insertMany: jest.fn() } }));
jest.mock('../src/models/Deal', () => ({ Deal: { insertMany: jest.fn() } }));
jest.mock('../src/models/Activity', () => ({ Activity: { insertMany: jest.fn() } }));
jest.mock('../src/models/Pipeline', () => ({ Pipeline: { find: jest.fn() }, PipelineStage: { find: jest.fn() } }));

import contactRoutes from '../src/routes/contactRoutes';
import companyRoutes from '../src/routes/companyRoutes';
import dealRoutes from '../src/routes/dealRoutes';
import { Contact } from '../src/models/Contact';
import { Company } from '../src/models/Company';
import { Deal } from '../src/models/Deal';
import { Pipeline, PipelineStage } from '../src/models/Pipeline';
import { normalizeHeader, parseImportCsv } from '../src/utils/csvImport';

const app = express();
app.use(express.json());
app.use('/contacts', contactRoutes);
app.use('/companies', companyRoutes);
app.use('/deals', dealRoutes);

/** Thenable stand-in for a mongoose query chain */
const query = (result: unknown) => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'collation', 'lean']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
};

const upload = (path: string, csv: string) =>
  request(app).post(path).attach('file', Buffer.from(csv), { filename: 'import.csv', contentType: 'text/csv' });

const echoInsert = (model: { insertMany: jest.Mock }) =>
  model.insertMany.mockImplementation(async (docs: Record<string, unknown>[]) =>
    docs.map((doc, i) => ({ ...doc, _id: `id-${i}` }))
  );

beforeEach(() => {
  jest.clearAllMocks();
  (Contact.find as jest.Mock).mockReturnValue(query([]));
  (Company.find as jest.Mock).mockReturnValue(query([]));
  echoInsert(Contact as unknown as { insertMany: jest.Mock });
  echoInsert(Company as unknown as { insertMany: jest.Mock });
  echoInsert(Deal as unknown as { insertMany: jest.Mock });
});

describe('parseImportCsv', () => {
  it('normalizes header spelling', () => {
    expect(normalizeHeader('﻿ First Name ')).toBe('first_name');
    expect(normalizeHeader('E-mail.Address')).toBe('e_mail_address');
  });

  it('splits known columns from custom fields and keeps the original header as the key', () => {
    const { rows, custom_columns } = parseImportCsv(
      'Name,Email,Lead Score,"Notes, internal"\nAda,ada@example.com,42,"likes ""math"""\n',
      { name: 'name', email: 'email' }
    );

    expect(custom_columns).toEqual(['Lead Score', 'Notes, internal']);
    expect(rows).toEqual([
      {
        fields: { name: 'Ada', email: 'ada@example.com' },
        custom_fields: { 'Lead Score': '42', 'Notes, internal': 'likes "math"' }
      }
    ]);
  });

  it('drops empty custom values and Mongo-unsafe key characters', () => {
    const { rows } = parseImportCsv('name,$weird.key,blank\nAda,x,\n', { name: 'name' });
    expect(rows[0].custom_fields).toEqual({ weird_key: 'x' });
  });
});

describe('POST /contacts/bulk-import', () => {
  it('requires name, email and phone and stores extra columns as custom fields', async () => {
    const csv = [
      'Full Name,Email,Phone,Job Title,LinkedIn,Budget',
      'Ada Lovelace,ADA@example.com,+44 20 7946 0000,Engineer,linkedin.com/in/ada,5k',
      'Grace,grace@example.com,,CTO,,',
      'Linus,not-an-email,555-0100-1,,,',
      'Cher,cher@example.com,555 0100,,,'
    ].join('\n');

    const response = await upload('/contacts/bulk-import', csv);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      imported: 2,
      failed: 2,
      custom_columns: ['LinkedIn', 'Budget'],
      errors: ['Row 2: phone is required', 'Row 3: email is invalid']
    });

    const [docs] = (Contact.insertMany as jest.Mock).mock.calls[0];
    expect(docs[0]).toMatchObject({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      phone: '+44 20 7946 0000',
      role_title: 'Engineer',
      custom_fields: { LinkedIn: 'linkedin.com/in/ada', Budget: '5k' }
    });
    // Single-word names are accepted
    expect(docs[1]).toMatchObject({ first_name: 'Cher', last_name: '' });
  });

  it('reports every missing compulsory field at once', async () => {
    const response = await upload('/contacts/bulk-import', 'name,email,phone,city\n,,,Lagos\n');
    expect(response.body.data.errors).toEqual(['Row 1: name, email, phone are required']);
    expect(Contact.insertMany).not.toHaveBeenCalled();
  });

  it('links an existing company by name and keeps an unmatched name in custom fields', async () => {
    (Company.find as jest.Mock).mockReturnValue(query([{ _id: COMPANY_ID, name: 'Acme Inc' }]));

    await upload(
      '/contacts/bulk-import',
      'first_name,last_name,email,phone,company\nAda,L,a@x.io,5550100,acme inc\nBob,B,b@x.io,5550101,Globex\n'
    );

    const [docs] = (Contact.insertMany as jest.Mock).mock.calls[0];
    expect(docs[0].company_id).toBe(COMPANY_ID);
    expect(docs[0].custom_fields).toEqual({});
    expect(docs[1].company_id).toBeUndefined();
    expect(docs[1].custom_fields).toEqual({ company: 'Globex' });
  });
});

describe('POST /companies/bulk-import', () => {
  it('requires name, email and phone and stores extra columns as custom fields', async () => {
    const csv = [
      'Company Name,Email,Phone Number,Industry,Employees,Tax ID',
      'Acme,hello@acme.com,555-0100,Manufacturing,250,TX-1',
      'Globex,,555-0101,,,'
    ].join('\n');

    const response = await upload('/companies/bulk-import', csv);

    expect(response.body.data).toMatchObject({
      imported: 1,
      failed: 1,
      custom_columns: ['Employees', 'Tax ID'],
      errors: ['Row 2: email is required']
    });
    const [docs] = (Company.insertMany as jest.Mock).mock.calls[0];
    expect(docs[0]).toMatchObject({
      name: 'Acme',
      email: 'hello@acme.com',
      phone: '555-0100',
      industry: 'Manufacturing',
      custom_fields: { Employees: '250', 'Tax ID': 'TX-1' }
    });
  });
});

describe('POST /deals/bulk-import', () => {
  beforeEach(() => {
    (Pipeline.find as jest.Mock).mockReturnValue(
      query([{ _id: PIPELINE_ID, name: 'Sales', is_default: true }])
    );
    (PipelineStage.find as jest.Mock).mockReturnValue(
      query([
        { _id: LEAD_STAGE_ID, name: 'Lead', pipeline_id: PIPELINE_ID, order: 0, is_won: false, is_lost: false },
        { _id: WON_STAGE_ID, name: 'Closed Won', pipeline_id: PIPELINE_ID, order: 5, is_won: true, is_lost: false }
      ])
    );
  });

  it('requires a CSV file', async () => {
    const response = await request(app).post('/deals/bulk-import');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'CSV file is required' });
  });

  it('maps title, value and stage and stores extra columns as custom fields', async () => {
    const csv = [
      'Deal Name,Amount,Stage,Close Date,Campaign,Priority',
      'Website redesign,"$12,500",closed won,2026-12-01,Spring promo,High',
      'Mobile app,5k,,,,Low',
      ',100,,,,',
      'Bad value,lots,,,,',
      'Unknown stage,100,Negotiation,,,'
    ].join('\n');

    const response = await upload('/deals/bulk-import', csv);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      imported: 2,
      failed: 3,
      custom_columns: ['Campaign', 'Priority'],
      errors: [
        'Row 3: title is required',
        'Row 4: value is invalid',
        'Row 5: stage "Negotiation" not found in pipeline "Sales"'
      ]
    });

    const [docs] = (Deal.insertMany as jest.Mock).mock.calls[0];
    expect(docs[0]).toMatchObject({
      title: 'Website redesign',
      value: 12500,
      stage_id: WON_STAGE_ID,
      status: 'won',
      source: 'csv_import',
      organization_id: expect.anything(),
      custom_fields: { Campaign: 'Spring promo', Priority: 'High' }
    });
    expect(docs[0].expected_close_date).toEqual(new Date('2026-12-01'));
    // No stage column value: first open stage of the default pipeline
    expect(docs[1]).toMatchObject({ title: 'Mobile app', value: 5000, stage_id: LEAD_STAGE_ID, status: 'open' });
  });

  it('defaults a missing value to 0 and accepts an explicit zero', async () => {
    await upload('/deals/bulk-import', 'title,value\nNo value,\nZero,$0.00\n');
    const [docs] = (Deal.insertMany as jest.Mock).mock.calls[0];
    expect(docs.map((doc: { value: number }) => doc.value)).toEqual([0, 0]);
  });

  it('links an existing contact by email and its company', async () => {
    (Contact.find as jest.Mock).mockReturnValue(
      query([{ _id: CONTACT_ID, email: 'ada@example.com', company_id: COMPANY_ID }])
    );

    await upload('/deals/bulk-import', 'title,contact_email\nRenewal,ADA@example.com\nNew biz,nobody@example.com\n');

    const [docs] = (Deal.insertMany as jest.Mock).mock.calls[0];
    expect(docs[0]).toMatchObject({ contact_id: CONTACT_ID, company_id: COMPANY_ID, custom_fields: {} });
    expect(docs[1].contact_id).toBeUndefined();
    expect(docs[1].custom_fields).toEqual({ contact_email: 'nobody@example.com' });
  });

  it('rejects an unknown status', async () => {
    const response = await upload('/deals/bulk-import', 'title,status\nX,pending\n');
    expect(response.body.data.errors).toEqual(['Row 1: status must be one of open, won, lost']);
  });
});

