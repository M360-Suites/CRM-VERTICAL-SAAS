import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const ORG_ID = '507f1f77bcf86cd799439012';
const EXISTING_ID = '607f1f77bcf86cd799439aaa';
const OTHER_ID = '607f1f77bcf86cd799439bbb';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret' } }));
jest.mock('../src/services/triggerService', () => ({ queueDealTriggers: jest.fn() }));
jest.mock('../src/services/socketService', () => ({ emitNotification: jest.fn(), emitDealStageChanged: jest.fn() }));
jest.mock('../src/services/dealAssignmentService', () => ({ assignDealOwner: jest.fn() }));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: ORG_ID, role: 'admin' };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

jest.mock('../src/models/Contact', () => {
  const Contact = jest.fn().mockImplementation((doc) => ({ ...doc, _id: 'new-contact', save: jest.fn() }));
  Object.assign(Contact, { findOne: jest.fn(), findOneAndUpdate: jest.fn(), exists: jest.fn() });
  return { Contact };
});
jest.mock('../src/models/Deal', () => {
  const Deal = jest.fn().mockImplementation((doc) => ({ ...doc, _id: 'new-deal', save: jest.fn() }));
  Object.assign(Deal, { findOne: jest.fn(), findOneAndUpdate: jest.fn() });
  return { Deal };
});
jest.mock('../src/models/Company', () => ({ Company: { exists: jest.fn() } }));
jest.mock('../src/models/Activity', () => ({ Activity: { create: jest.fn() } }));
jest.mock('../src/models/Pipeline', () => ({ Pipeline: {}, PipelineStage: { exists: jest.fn(), findOne: jest.fn() } }));

import contactRoutes from '../src/routes/contactRoutes';
import dealRoutes from '../src/routes/dealRoutes';
import { Contact } from '../src/models/Contact';
import { Deal } from '../src/models/Deal';

const app = express();
app.use(express.json());
app.use('/contacts', contactRoutes);
app.use('/deals', dealRoutes);

/** Thenable stand-in for a mongoose query chain */
const query = (result: unknown) => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'collation', 'lean', 'populate']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
};

const ContactMock = Contact as unknown as jest.Mock & { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
const DealMock = Deal as unknown as jest.Mock & { findOne: jest.Mock; findOneAndUpdate: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('contact duplicates', () => {
  it('returns 409 with the existing contact when the email is already used (case-insensitive)', async () => {
    ContactMock.findOne.mockReturnValueOnce(
      query({ _id: EXISTING_ID, first_name: 'Ada', last_name: 'L', email: 'ada@x.io' })
    );

    const response = await request(app)
      .post('/contacts')
      .send({ first_name: 'Ada', last_name: 'Lovelace', email: '  ADA@x.io ' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: false,
      code: 'DUPLICATE_CONTACT',
      message: 'A contact with this email already exists',
      data: { duplicate: { _id: EXISTING_ID, matched_on: 'email' } }
    });
    const [filter] = ContactMock.findOne.mock.calls[0];
    expect(filter.$or).toEqual([{ email: 'ada@x.io' }]);
    expect(ContactMock).not.toHaveBeenCalled();
  });

  it('reports a phone match', async () => {
    ContactMock.findOne.mockReturnValueOnce(query({ _id: EXISTING_ID, first_name: 'A', last_name: 'B', phone: '555' }));
    const response = await request(app).post('/contacts').send({ first_name: 'A', last_name: 'B', phone: '555' });
    expect(response.status).toBe(409);
    expect(response.body.data.duplicate.matched_on).toBe('phone');
  });

  it('creates the contact when allow_duplicate is set', async () => {
    ContactMock.findOne.mockReturnValue(query({ _id: 'new-contact' }));
    const response = await request(app)
      .post('/contacts')
      .send({ first_name: 'Ada', last_name: 'L', email: 'ada@x.io', allow_duplicate: true });
    expect(response.status).toBe(201);
    expect(ContactMock).toHaveBeenCalledTimes(1);
  });

  it('blocks an update that would reuse another contact’s email', async () => {
    ContactMock.findOne.mockReturnValueOnce(query({ _id: OTHER_ID, first_name: 'B', last_name: 'C', email: 'b@x.io' }));

    const response = await request(app).patch(`/contacts/${EXISTING_ID}`).send({ email: 'b@x.io' });

    expect(response.status).toBe(409);
    const [filter] = ContactMock.findOne.mock.calls[0];
    expect(filter._id.$ne.toString()).toBe(EXISTING_ID);
    expect(ContactMock.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('deal duplicates', () => {
  it('returns 409 when an open deal with the same title exists for the same contact/company', async () => {
    DealMock.findOne.mockReturnValueOnce(query({ _id: EXISTING_ID, title: 'Website Redesign', status: 'open' }));

    const response = await request(app).post('/deals').send({ title: 'website redesign' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'DUPLICATE_DEAL', data: { duplicate: { _id: EXISTING_ID } } });
    const [filter] = DealMock.findOne.mock.calls[0];
    expect(filter).toMatchObject({ status: 'open', title: 'website redesign', contact_id: null, company_id: null });
    expect(DealMock).not.toHaveBeenCalled();
  });

  it('creates the deal when no open duplicate exists', async () => {
    DealMock.findOne.mockReturnValueOnce(query(null)).mockReturnValue(query({ _id: 'new-deal' }));
    const response = await request(app).post('/deals').send({ title: 'Website redesign' });
    expect(response.status).toBe(201);
    expect(DealMock).toHaveBeenCalledTimes(1);
  });
});
