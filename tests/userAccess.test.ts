import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = {
      id: '507f1f77bcf86cd799439011',
      organization_id: '507f1f77bcf86cd799439012',
      role: 'admin',
      email: 'admin@acme.com',
      display_name: 'Admin'
    };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
jest.mock('../src/utils/email', () => ({ sendUserInvitationEmail: jest.fn(), sendWelcomeEmail: jest.fn() }));

import userRoutes from '../src/routes/userRoutes';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { UserInvitation } from '../src/models/UserInvitation';
import { sendUserInvitationEmail } from '../src/utils/email';

const app = express();
app.use(express.json());
app.use('/users', userRoutes);
const authed = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const ORG_ID = '507f1f77bcf86cd799439012';
const STAFF_ID = '507f1f77bcf86cd799439013';
const OWNER_ID = '507f1f77bcf86cd799439099';
const NEW_INVITE_ID = '507f1f77bcf86cd799439077';

const chain = <T>(value: T) => ({ select: () => ({ lean: () => Promise.resolve(value) }) });
/** Resolves directly, or after .select(), like a Mongoose query */
const query = <T>(value: T) => Object.assign(Promise.resolve(value), { select: () => Promise.resolve(value) });

let findOneAndUpdate: jest.SpyInstance;
let revokeMany: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(Organization, 'findById').mockReturnValue(chain({ owner_id: OWNER_ID, name: 'Acme' }) as never);
  findOneAndUpdate = jest
    .spyOn(User, 'findOneAndUpdate')
    .mockReturnValue(query({ _id: STAFF_ID, role: 'viewer', is_active: false }) as never);
  revokeMany = jest.spyOn(UserInvitation, 'updateMany').mockResolvedValue({ modifiedCount: 0 } as never);
});

afterEach(() => jest.restoreAllMocks());

describe('admins cannot lock the organization out', () => {
  it.each([
    ['deactivate (DELETE /users/:id)', (id: string) => request(app).delete(`/users/${id}`)],
    ['deactivate (PATCH is_active=false)', (id: string) => request(app).patch(`/users/${id}`).send({ is_active: false })],
    ['demote (PATCH role)', (id: string) => request(app).patch(`/users/${id}`).send({ role: 'viewer' })],
    ['demote (POST /role)', (id: string) => request(app).post(`/users/${id}/role`).send({ role: 'sales_rep' })],
    ['demote (DELETE /role)', (id: string) => request(app).delete(`/users/${id}/role`)]
  ])('blocks an admin from changing themselves: %s', async (_label, send) => {
    const response = await authed(send(ADMIN_ID));
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/your own/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['deactivate', (id: string) => request(app).delete(`/users/${id}`)],
    ['demote', (id: string) => request(app).post(`/users/${id}/role`).send({ role: 'viewer' })]
  ])('blocks changes that would %s the organization owner', async (_label, send) => {
    const response = await authed(send(OWNER_ID));
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/owner/);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('still lets an admin rename themselves', async () => {
    const response = await authed(request(app).patch(`/users/${ADMIN_ID}`).send({ display_name: 'New Name' }));
    expect(response.status).toBe(200);
  });

  it('still lets an admin promote someone else to admin', async () => {
    const response = await authed(request(app).post(`/users/${STAFF_ID}/role`).send({ role: 'admin' }));
    expect(response.status).toBe(200);
    expect(revokeMany).not.toHaveBeenCalled();
  });

  it('deactivating someone signs out their sessions and cancels the invites they sent', async () => {
    const response = await authed(request(app).delete(`/users/${STAFF_ID}`));
    expect(response.status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: { token_version: 1 } }),
      expect.anything()
    );
    expect(revokeMany).toHaveBeenCalledWith(
      expect.objectContaining({ invited_by: expect.anything(), accepted_at: null, revoked_at: null }),
      { $set: { revoked_at: expect.any(Date) } }
    );
  });

  it('demoting an admin cancels the invites they sent', async () => {
    const response = await authed(request(app).delete(`/users/${STAFF_ID}/role`));
    expect(response.status).toBe(200);
    expect(revokeMany).toHaveBeenCalledWith(expect.objectContaining({ invited_by: expect.anything() }), expect.anything());
  });
});

describe('POST /users/invitations', () => {
  let createInvite: jest.SpyInstance;
  let deleteInvite: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(User, 'findOne').mockReturnValue(chain(null) as never);
    createInvite = jest.spyOn(UserInvitation, 'create').mockResolvedValue({
      _id: NEW_INVITE_ID,
      email: 'new@acme.com',
      role: 'viewer'
    } as never);
    deleteInvite = jest.spyOn(UserInvitation, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
    (sendUserInvitationEmail as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('rejects an invalid email address before creating anything', async () => {
    const response = await authed(request(app).post('/users/invitations')).send({ email: 'bob@nowhere' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not a valid email/);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it('tells the admin to reactivate a deactivated member instead of re-inviting', async () => {
    jest
      .spyOn(User, 'findOne')
      .mockReturnValue(chain({ organization_id: ORG_ID, is_active: false, deactivated_at: new Date() }) as never);
    const response = await authed(request(app).post('/users/invitations')).send({ email: 'old@acme.com' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/deactivated.*Reactivate/);
  });

  it('cancels older links only after the new email is sent', async () => {
    const response = await authed(request(app).post('/users/invitations')).send({ email: 'new@acme.com' });
    expect(response.status).toBe(201);
    expect(sendUserInvitationEmail).toHaveBeenCalled();
    expect(revokeMany).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $ne: NEW_INVITE_ID }, email: 'new@acme.com' }),
      expect.anything()
    );
  });

  it('when the email fails: removes the unsent invite, keeps older links, and says so', async () => {
    (sendUserInvitationEmail as jest.Mock).mockRejectedValue(new Error('provider down'));
    const response = await authed(request(app).post('/users/invitations')).send({ email: 'new@acme.com' });
    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/couldn't send the invitation email/);
    expect(deleteInvite).toHaveBeenCalledWith({ _id: NEW_INVITE_ID });
    expect(revokeMany).not.toHaveBeenCalled();
  });
});

describe('POST /users', () => {
  it('rejects a missing email instead of crashing', async () => {
    const response = await authed(request(app).post('/users')).send({ password: 'longenough', display_name: 'Rep' });
    expect(response.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const response = await authed(request(app).post('/users')).send({ email: 'rep@acme.com', password: '1', display_name: 'Rep' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid email address', async () => {
    const response = await authed(request(app).post('/users')).send({
      email: 'not-an-email',
      password: 'longenough',
      display_name: 'Rep'
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('A valid email address is required');
  });
});
