import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'admin' }; next();
  }, authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
jest.mock('../src/utils/email', () => ({ sendUserInvitationEmail: jest.fn() }));
import userRoutes from '../src/routes/userRoutes';
import { User } from '../src/models/User';
import { Organization } from '../src/models/Organization';
import { Deal } from '../src/models/Deal';
import { Contact } from '../src/models/Contact';
import { Company } from '../src/models/Company';
import { Task } from '../src/models/Task';
import { CRMFile } from '../src/models/Document';
import { Folder } from '../src/models/Folder';
import { PipelineStage } from '../src/models/Pipeline';
import { RoutingRule } from '../src/models/RoutingRule';
import { Notification } from '../src/models/Notification';
import { SocialAccount } from '../src/models/SocialAccount';
import { EmailMessage } from '../src/models/EmailMessage';
import { PasswordResetOtp } from '../src/models/PasswordResetOtp';
import { EmailVerificationOtp } from '../src/models/EmailVerificationOtp';

const app = express(); app.use(express.json()); app.use('/users', userRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

const ADMIN_ID = '507f1f77bcf86cd799439011';
const STAFF_ID = '507f1f77bcf86cd799439013';
const OWNER_ID = '507f1f77bcf86cd799439099';

describe('users API', () => {
  it('requires authentication for user management', async () => expect((await request(app).get('/users')).status).toBe(401));
  it('requires invitation credentials', async () => {
    const response = await request(app).post('/users/invitations/accept').send({});
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Validation failed' });
  });
});

describe('DELETE /users/:id/permanent', () => {
  const staffDoc = { _id: STAFF_ID, email: 'rep@acme.com', display_name: 'Rep', role: 'sales_rep' };
  const adminDoc = { _id: ADMIN_ID, email: 'admin@acme.com', display_name: 'Admin' };

  const mockFindOne = (staff: unknown, reassignTo: unknown) => {
    jest.spyOn(User, 'findOne').mockImplementation(((filter: Record<string, unknown>) => {
      const isStaffLookup = String(filter._id) === STAFF_ID && filter.is_active === undefined;
      return {
        select: () => (isStaffLookup ? Promise.resolve(staff) : { lean: () => Promise.resolve(reassignTo) })
      };
    }) as never);
  };
  const mockOrg = (ownerId: string) =>
    jest.spyOn(Organization, 'findById').mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ owner_id: ownerId }) }) } as never);

  let updates: jest.SpyInstance[] = [];
  let deleteUser: jest.SpyInstance;

  beforeEach(() => {
    const result = { modifiedCount: 2 } as never;
    updates = [Deal, Contact, Company, Task, CRMFile, Folder, PipelineStage, RoutingRule].map((model) =>
      jest.spyOn(model as never as typeof Deal, 'updateMany').mockResolvedValue(result)
    );
    [Notification, SocialAccount, EmailMessage, PasswordResetOtp, EmailVerificationOtp].forEach((model) =>
      jest.spyOn(model as never as typeof Deal, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as never)
    );
    deleteUser = jest.spyOn(User, 'deleteOne').mockResolvedValue({ deletedCount: 1 } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects an invalid ID with a descriptive message', async () => {
    const response = await authenticated(request(app).delete('/users/not-an-id/permanent'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, code: 'INVALID_ID' });
    expect(response.body.message).toContain('not-an-id');
  });

  it('prevents admins from deleting themselves', async () => {
    const response = await authenticated(request(app).delete(`/users/${ADMIN_ID}/permanent`));
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/cannot delete your own account/);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('returns 404 when the staff member is not in the organization', async () => {
    mockFindOne(null, adminDoc);
    const response = await authenticated(request(app).delete(`/users/${STAFF_ID}/permanent`));
    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Staff member not found in your organization');
  });

  it('refuses to delete the organization owner', async () => {
    mockFindOne(staffDoc, adminDoc);
    mockOrg(STAFF_ID);
    const response = await authenticated(request(app).delete(`/users/${STAFF_ID}/permanent`));
    expect(response.status).toBe(409);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('reassigns records to the admin and deletes the staff member', async () => {
    mockFindOne(staffDoc, adminDoc);
    mockOrg(OWNER_ID);
    const response = await authenticated(request(app).delete(`/users/${STAFF_ID}/permanent`));
    expect(response.status).toBe(200);
    expect(response.body.data.reassigned_to.id).toBe(ADMIN_ID);
    expect(response.body.data.reassigned.deals).toBe(2);
    expect(updates[0]).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: expect.anything() }),
      { $set: { owner_id: expect.anything() } }
    );
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('rejects a reassign_to user outside the organization', async () => {
    mockFindOne(staffDoc, null);
    mockOrg(OWNER_ID);
    const response = await authenticated(
      request(app).delete(`/users/${STAFF_ID}/permanent`).send({ reassign_to: '507f1f77bcf86cd799439055' })
    );
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('reassign_to must be an active staff member in your organization');
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
