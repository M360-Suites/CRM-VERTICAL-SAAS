/**
 * Email Templates screen: template categories, the category filter on the list,
 * per-category counts and design in list items for card previews.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

const orgId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();
const templateId = new mongoose.Types.ObjectId();

const chain = <T>(value: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'sort', 'skip', 'limit']) query[method] = jest.fn(() => query);
  query.lean = jest.fn().mockResolvedValue(value);
  return query;
};

const templateModel = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  aggregate: jest.fn()
};

jest.mock('../src/models/EmailTemplate', () => {
  const actual = jest.requireActual('../src/models/EmailTemplate');
  return { ...actual, EmailTemplate: templateModel };
});
jest.mock('../src/models/EmailTrigger', () => ({ EmailTrigger: {} }));
jest.mock('../src/models/Organization', () => ({ Organization: {} }));
jest.mock('../src/utils/ensendMailer', () => ({ isEmailConfigured: () => false, sendEmail: jest.fn() }));
jest.mock('../src/config/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = { id: userId.toString(), organization_id: orgId.toString(), email: 'me@acme.test', role: 'admin' };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

import emailTemplateRoutes from '../src/routes/emailTemplateRoutes';

const app = express();
app.use(express.json());
app.use('/email-templates', emailTemplateRoutes);

const echoCreate = () =>
  templateModel.create.mockImplementation(async (doc: Record<string, unknown>) => ({
    toObject: () => ({ _id: templateId, ...doc })
  }));

const validBody = { name: 'Welcome', subject: 'Hi', html: '<p>Hi</p>' };

beforeEach(() => jest.clearAllMocks());

describe('template category field', () => {
  it('stores and returns a category on create', async () => {
    echoCreate();
    const res = await request(app).post('/email-templates').send({ ...validBody, category: 'welcome' });

    expect(res.status).toBe(201);
    expect(templateModel.create.mock.calls[0][0].category).toBe('welcome');
    expect(res.body.data.category).toBe('welcome');
  });

  it('leaves category empty when not sent', async () => {
    echoCreate();
    const res = await request(app).post('/email-templates').send(validBody);

    expect(res.status).toBe(201);
    expect(templateModel.create.mock.calls[0][0].category).toBeUndefined();
    expect(res.body.data.category).toBeNull();
  });

  it('rejects an unknown category on create and update', async () => {
    const created = await request(app).post('/email-templates').send({ ...validBody, category: 'spam' });
    expect(created.status).toBe(400);
    expect(created.body.message).toMatch(/category must be one of: sales, welcome/);

    const updated = await request(app).patch(`/email-templates/${templateId}`).send({ category: 42 });
    expect(updated.status).toBe(400);
    expect(templateModel.create).not.toHaveBeenCalled();
    expect(templateModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sets and clears the category on update', async () => {
    templateModel.findOneAndUpdate.mockReturnValue(chain({ _id: templateId, ...validBody, category: 'promo' }));
    const set = await request(app).patch(`/email-templates/${templateId}`).send({ category: 'promo' });
    expect(set.status).toBe(200);
    expect(templateModel.findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: expect.objectContaining({ category: 'promo' }) });

    templateModel.findOneAndUpdate.mockReturnValue(chain({ _id: templateId, ...validBody }));
    const cleared = await request(app).patch(`/email-templates/${templateId}`).send({ category: null });
    expect(cleared.status).toBe(200);
    expect(templateModel.findOneAndUpdate.mock.calls[1][1].$unset).toEqual({ category: 1 });
    expect(cleared.body.data.category).toBeNull();
  });

  it('copies the category when duplicating', async () => {
    templateModel.findOne.mockReturnValue(chain({ _id: templateId, ...validBody, category: 'newsletter', design: { rows: [] } }));
    echoCreate();

    const res = await request(app).post(`/email-templates/${templateId}/duplicate`);

    expect(res.status).toBe(201);
    expect(templateModel.create.mock.calls[0][0]).toMatchObject({ category: 'newsletter', name: 'Welcome (copy)' });
  });

  it('returns the category on get', async () => {
    templateModel.findOne.mockReturnValue(chain({ _id: templateId, ...validBody, category: 'sales' }));
    const res = await request(app).get(`/email-templates/${templateId}`);
    expect(res.body.data).toMatchObject({ category: 'sales', html: '<p>Hi</p>' });
  });
});

describe('list filtering and previews', () => {
  const stubList = (items: unknown[], total: number) => {
    const query = chain(items);
    templateModel.find.mockReturnValue(query);
    templateModel.countDocuments.mockResolvedValue(total);
    return query;
  };

  it('filters by any of several categories, combined with search, and counts only matches', async () => {
    stubList([], 30);
    const res = await request(app).get('/email-templates?category=welcome,newsletter&search=promo&page=2&limit=24');

    expect(res.status).toBe(200);
    const filter = templateModel.find.mock.calls[0][0];
    expect(filter.category).toEqual({ $in: ['welcome', 'newsletter'] });
    expect(filter.name).toEqual({ $regex: 'promo', $options: 'i' });
    expect(templateModel.countDocuments.mock.calls[0][0]).toBe(filter);
    expect(res.body.data).toMatchObject({ total: 30, page: 2, limit: 24, total_pages: 2 });
  });

  it('also accepts a repeated category param', async () => {
    stubList([], 0);
    await request(app).get('/email-templates?category=sales&category=promo');
    expect(templateModel.find.mock.calls[0][0].category).toEqual({ $in: ['sales', 'promo'] });
  });

  it('returns all templates without a category param', async () => {
    stubList([], 0);
    await request(app).get('/email-templates');
    expect(templateModel.find.mock.calls[0][0]).not.toHaveProperty('category');
  });

  it('rejects an unknown category value', async () => {
    const res = await request(app).get('/email-templates?category=welcome,bogus');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category must be one of/);
    expect(templateModel.find).not.toHaveBeenCalled();
  });

  it('returns design but not html in list items', async () => {
    const design = { rows: [{ type: 'text', value: 'Hi' }] };
    const query = stubList([{ _id: templateId, name: 'A', subject: 'B', category: 'promo', design }], 1);

    const res = await request(app).get('/email-templates');

    expect(query.select).toHaveBeenCalledWith('-html');
    expect(res.body.data.data[0]).toMatchObject({ category: 'promo', design });
    expect(res.body.data.data[0]).not.toHaveProperty('html');
  });
});

describe('GET /email-templates/categories', () => {
  it('returns every category with its count, plus uncategorized', async () => {
    templateModel.aggregate.mockResolvedValue([
      { _id: 'welcome', count: 4 },
      { _id: 'promo', count: 1 },
      { _id: null, count: 7 }
    ]);

    const res = await request(app).get('/email-templates/categories');

    expect(res.status).toBe(200);
    expect(templateModel.aggregate.mock.calls[0][0][0]).toEqual({ $match: { organization_id: orgId } });
    expect(res.body.data.uncategorized).toBe(7);
    expect(res.body.data.categories).toEqual([
      { value: 'sales', label: 'Sales templates', count: 0 },
      { value: 'welcome', label: 'Welcome email', count: 4 },
      { value: 'promo', label: 'Promo templates', count: 1 },
      { value: 'newsletter', label: 'Newsletter', count: 0 },
      { value: 'new_sales_alert', label: 'New sales Alert', count: 0 },
      { value: 'price_discount', label: 'Price discount', count: 0 }
    ]);
  });
});
