/**
 * Backend gaps raised by the email editor work: drafts without a subject, the
 * design field, test sends to teammates, email image uploads and the
 * suppression list.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

const orgId = new mongoose.Types.ObjectId();
const userId = new mongoose.Types.ObjectId();
const broadcastId = new mongoose.Types.ObjectId();

const chain = <T>(value: T) => {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'sort', 'skip', 'limit', 'populate']) query[method] = jest.fn(() => query);
  query.lean = jest.fn().mockResolvedValue(value);
  return query;
};

const broadcastModel = { create: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), exists: jest.fn(), findById: jest.fn() };
const userModel = { find: jest.fn() };
const organizationModel = { findById: jest.fn() };
const contactModel = { find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(), findOneAndUpdate: jest.fn(), exists: jest.fn() };
const sendBroadcastBatch = jest.fn();
const cloudinaryUpload = jest.fn();

jest.mock('../src/models/Broadcast', () => ({ Broadcast: broadcastModel }));
jest.mock('../src/models/BroadcastRecipient', () => ({ BroadcastRecipient: {} }));
jest.mock('../src/models/EmailTemplate', () => ({ EmailTemplate: { findOne: jest.fn() } }));
jest.mock('../src/models/Contact', () => ({ Contact: contactModel }));
jest.mock('../src/models/Organization', () => ({ Organization: organizationModel }));
jest.mock('../src/models/User', () => ({ User: userModel }));
jest.mock('../src/services/broadcastService', () => ({
  buildAudienceFilter: jest.fn(() => ({})),
  cancelBroadcast: jest.fn(),
  startBroadcast: jest.fn()
}));
jest.mock('../src/utils/ensendMailer', () => ({
  isEmailConfigured: () => true,
  sendBroadcastBatch,
  toEnsendTemplate: (subject: string, html: string) => ({ subject, html, variablesFor: (values: Record<string, string>) => values })
}));
jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test', BACKEND_URL: 'https://api.test' } }));
jest.mock('../src/config/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../src/config/cloudinary', () => ({ __esModule: true, default: { uploader: { upload: cloudinaryUpload } } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    req.user = {
      id: userId.toString(),
      organization_id: orgId.toString(),
      email: 'me@acme.test',
      display_name: 'Me',
      role: req.header('x-test-role') || 'admin'
    };
    next();
  },
  authorize: (...roles: string[]) => (req: Request & { user?: { role: string } }, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ status: false });
      return;
    }
    next();
  }
}));

import broadcastRoutes from '../src/routes/broadcastRoutes';
import emailImageRoutes from '../src/routes/emailImageRoutes';
import emailSuppressionRoutes from '../src/routes/emailSuppressionRoutes';
import { handleError } from '../src/utils/errorHandler';

const app = express();
app.use(express.json());
app.use('/broadcasts', broadcastRoutes);
app.use('/email-images', emailImageRoutes);
app.use('/email-suppressions', emailSuppressionRoutes);
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => handleError(res, err, 'failed'));

beforeEach(() => jest.clearAllMocks());

describe('broadcast drafts', () => {
  it('creates a draft with only a name', async () => {
    broadcastModel.create.mockImplementation(async (doc: Record<string, unknown>) => ({
      toObject: () => ({ _id: broadcastId, status: 'draft', stats: {}, ...doc })
    }));

    const res = await request(app).post('/broadcasts').send({ name: 'Untitled' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: broadcastId.toString(), name: 'Untitled', subject: null, html: null, design: null });
  });

  it('stores the editor design and returns it', async () => {
    const design = { rows: [{ type: 'text', value: 'Hi' }] };
    broadcastModel.create.mockImplementation(async (doc: Record<string, unknown>) => ({
      toObject: () => ({ _id: broadcastId, status: 'draft', stats: {}, ...doc })
    }));

    const res = await request(app).post('/broadcasts').send({ name: 'With design', design });

    expect(res.status).toBe(201);
    expect(broadcastModel.create.mock.calls[0][0].design).toEqual(design);
    expect(res.body.data.design).toEqual(design);
  });

  it('rejects a design that is not an object', async () => {
    const res = await request(app).post('/broadcasts').send({ name: 'Bad', design: '<html>' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/design/);
  });

  it('still requires a name', async () => {
    const res = await request(app).post('/broadcasts').send({ subject: 'Hello' });
    expect(res.status).toBe(400);
  });

  it('refuses to send a draft without a subject', async () => {
    broadcastModel.findOne.mockReturnValue(chain({ _id: broadcastId, status: 'draft', audience: { all: true }, html: '<p>Hi</p>' }));

    const res = await request(app).post(`/broadcasts/${broadcastId}/send`).send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Add a subject before sending');
  });
});

describe('test sends', () => {
  const ready = { subject: 'Hello', html: '<p>Hi</p>' };

  beforeEach(() => {
    broadcastModel.findOne.mockReturnValue(chain(ready));
    organizationModel.findById.mockReturnValue(chain({ name: 'Acme' }));
    sendBroadcastBatch.mockResolvedValue('ref-1');
  });

  it('goes to the current user by default', async () => {
    const res = await request(app).post(`/broadcasts/${broadcastId}/test`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.sent_to).toEqual(['me@acme.test']);
    expect(userModel.find).not.toHaveBeenCalled();
  });

  it('goes to active teammates in the same organization', async () => {
    userModel.find.mockReturnValue(chain([{ email: 'ada@acme.test', display_name: 'Ada' }]));

    const res = await request(app).post(`/broadcasts/${broadcastId}/test`).send({ to: ['Ada@Acme.test'] });

    expect(res.status).toBe(200);
    const [filter] = userModel.find.mock.calls[0];
    expect(filter).toMatchObject({ organization_id: orgId, email: { $in: ['ada@acme.test'] }, is_active: true, deactivated_at: null });
    expect(sendBroadcastBatch.mock.calls[0][0].recipients.map((r: { address: string }) => r.address)).toEqual(['ada@acme.test']);
  });

  it('greets each teammate by their own name, not the sample contact', async () => {
    userModel.find.mockReturnValue(
      chain([
        { email: 'grace@acme.test', display_name: 'Grace Hopper' },
        { email: 'linus@acme.test', display_name: 'Linus' }
      ])
    );

    await request(app).post(`/broadcasts/${broadcastId}/test`).send({ to: ['grace@acme.test', 'linus@acme.test'] });

    const [grace, linus] = sendBroadcastBatch.mock.calls[0][0].recipients;
    expect(grace.variables).toMatchObject({
      'contact.first_name': 'Grace',
      'contact.last_name': 'Hopper',
      'contact.full_name': 'Grace Hopper',
      'contact.email': 'grace@acme.test',
      'organization.name': 'Acme'
    });
    expect(linus.variables['contact.first_name']).toBe('Linus');
    expect(linus.variables['contact.last_name']).toBeUndefined();
    expect(JSON.stringify([grace.variables, linus.variables])).not.toMatch(/Ada|Lovelace/);
  });

  it('refuses addresses outside the organization', async () => {
    userModel.find.mockReturnValue(chain([]));

    const res = await request(app).post(`/broadcasts/${broadcastId}/test`).send({ to: ['stranger@gmail.com'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stranger@gmail.com/);
    expect(sendBroadcastBatch).not.toHaveBeenCalled();
  });

  it('caps the number of test recipients', async () => {
    const to = Array.from({ length: 6 }, (_, i) => `u${i}@acme.test`);
    const res = await request(app).post(`/broadcasts/${broadcastId}/test`).send({ to });
    expect(res.status).toBe(400);
    expect(sendBroadcastBatch).not.toHaveBeenCalled();
  });

  it('refuses a test of an empty draft', async () => {
    broadcastModel.findOne.mockReturnValue(chain({ subject: undefined, html: undefined }));
    const res = await request(app).post(`/broadcasts/${broadcastId}/test`).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Add a subject and content before sending a test');
  });
});

describe('POST /email-images', () => {
  it('uploads to a per-organization Cloudinary folder and returns the public URL', async () => {
    cloudinaryUpload.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/x/image/upload/v1/crm/email-images/a.png',
      public_id: 'crm/email-images/a',
      width: 600,
      height: 300,
      format: 'png',
      bytes: 1234
    });

    const res = await request(app)
      .post('/email-images')
      .attach('image', Buffer.from('fake-png'), { filename: 'banner.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ url: expect.stringMatching(/^https:/), width: 600, height: 300 });
    expect(cloudinaryUpload.mock.calls[0][1]).toMatchObject({ resource_type: 'image', folder: `crm/email-images/${orgId}` });
  });

  it('rejects files that are not email-safe images', async () => {
    const res = await request(app)
      .post('/email-images')
      .attach('image', Buffer.from('<svg/>'), { filename: 'logo.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
    expect(cloudinaryUpload).not.toHaveBeenCalled();
  });

  it('rejects images over 5 MB', async () => {
    const res = await request(app)
      .post('/email-images')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(413);
    expect(cloudinaryUpload).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    const res = await request(app).post('/email-images').set('x-test-role', 'sales_rep');
    expect(res.status).toBe(403);
  });
});

describe('email suppressions', () => {
  it('lists suppressed contacts with per-reason counts', async () => {
    const at = new Date('2026-11-01T00:00:00Z');
    contactModel.find.mockReturnValue(
      chain([{ _id: 'c1', first_name: 'Ada', last_name: 'L', email: 'ada@x.test', email_opt_out_reason: 'bounced', email_opt_out_at: at }])
    );
    contactModel.countDocuments.mockResolvedValue(1);
    contactModel.aggregate.mockResolvedValue([{ _id: 'bounced', count: 1 }, { _id: 'unsubscribed', count: 4 }]);

    const res = await request(app).get('/email-suppressions?reason=bounced');

    expect(res.status).toBe(200);
    expect(contactModel.find.mock.calls[0][0]).toMatchObject({ organization_id: orgId, email_opt_out: true, email_opt_out_reason: 'bounced' });
    expect(res.body.data.data[0]).toEqual({ contact_id: 'c1', name: 'Ada L', email: 'ada@x.test', reason: 'bounced', suppressed_at: at.toISOString() });
    expect(res.body.data.counts).toEqual({ unsubscribed: 4, bounced: 1, complained: 0 });
  });

  it('lifts a suppression', async () => {
    const contactId = new mongoose.Types.ObjectId();
    contactModel.findOneAndUpdate.mockReturnValue(chain({ _id: contactId, email: 'ada@x.test' }));

    const res = await request(app).delete(`/email-suppressions/${contactId}`);

    expect(res.status).toBe(200);
    const [filter, update] = contactModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ _id: contactId, organization_id: orgId, email_opt_out: true });
    expect(update).toEqual({ $set: { email_opt_out: false }, $unset: { email_opt_out_reason: 1, email_opt_out_at: 1 } });
  });

  it('answers 409 for a contact that is not suppressed', async () => {
    contactModel.findOneAndUpdate.mockReturnValue(chain(null));
    contactModel.exists.mockResolvedValue({ _id: 'c1' });

    const res = await request(app).delete(`/email-suppressions/${new mongoose.Types.ObjectId()}`);
    expect(res.status).toBe(409);
  });

  it('is admin only', async () => {
    const res = await request(app).get('/email-suppressions').set('x-test-role', 'sales_manager');
    expect(res.status).toBe(403);
  });
});
