import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const ORG_ID = '507f1f77bcf86cd799439012';
const USER_ID = '507f1f77bcf86cd799439011';
const DEAL_ID = '507f1f77bcf86cd799439013';
const OWNER_ID = '507f1f77bcf86cd799439014';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret' } }));
jest.mock('../src/services/triggerService', () => ({ queueDealTriggers: jest.fn() }));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = {
      id: '507f1f77bcf86cd799439011',
      organization_id: '507f1f77bcf86cd799439012',
      role: req.header('x-test-role') || 'admin'
    };
    next();
  },
  authorize: (...roles: string[]) => (req: Request & { user?: { role: string } }, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return void res.status(403).json({ status: false, message: "You don't have permission to perform this action" });
    }
    next();
  }
}));

jest.mock('../src/services/dealAssignmentService', () => ({ assignDealOwner: jest.fn() }));

jest.mock('../src/models/Organization', () => ({
  ASSIGNMENT_MODES: ['auto', 'manual'],
  Organization: { findById: jest.fn(), findByIdAndUpdate: jest.fn() }
}));
jest.mock('../src/models/Contact', () => ({ Contact: { updateOne: jest.fn(), aggregate: jest.fn() } }));
jest.mock('../src/models/Deal', () => ({ Deal: { updateOne: jest.fn() } }));
jest.mock('../src/models/User', () => ({ User: { find: jest.fn(), exists: jest.fn() } }));
jest.mock('../src/models/RoutingRule', () => ({ RoutingRule: { find: jest.fn() } }));
jest.mock('../src/models/Notification', () => ({ Notification: { create: jest.fn() } }));
jest.mock('../src/services/socketService', () => ({ emitNotification: jest.fn(), emitDealStageChanged: jest.fn() }));

import dealRoutes from '../src/routes/dealRoutes';
import orgSettingsRoutes from '../src/routes/orgSettingsRoutes';
import { assignDealOwner } from '../src/services/dealAssignmentService';
import { routeNewLead } from '../src/services/leadRoutingService';
import { Organization } from '../src/models/Organization';
import { Contact } from '../src/models/Contact';
import { Deal } from '../src/models/Deal';
import { User } from '../src/models/User';
import { RoutingRule } from '../src/models/RoutingRule';
import mongoose from 'mongoose';

const app = express();
app.use(express.json());
app.use('/deals', dealRoutes);
app.use('/org', orgSettingsRoutes);
const as = (role: string, test: request.Test) => test.set('Authorization', 'Bearer t').set('x-test-role', role);
const lean = <T>(value: T) => ({ select: () => ({ lean: () => Promise.resolve(value) }), lean: () => Promise.resolve(value) });

beforeEach(() => jest.clearAllMocks());

describe('PATCH /deals/:id/assign', () => {
  it.each(['sales_rep', 'viewer'])('forbids %s', async (role) => {
    const response = await as(role, request(app).patch(`/deals/${DEAL_ID}/assign`)).send({ owner_id: OWNER_ID });
    expect(response.status).toBe(403);
    expect(assignDealOwner).not.toHaveBeenCalled();
  });

  it('requires owner_id in the body', async () => {
    const response = await as('admin', request(app).patch(`/deals/${DEAL_ID}/assign`)).send({});
    expect(response.status).toBe(400);
  });

  it('rejects a malformed owner_id', async () => {
    const response = await as('admin', request(app).patch(`/deals/${DEAL_ID}/assign`)).send({ owner_id: 'nope' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Invalid owner_id');
  });

  it.each(['admin', 'sales_manager'])('lets %s assign a deal', async (role) => {
    (assignDealOwner as jest.Mock).mockResolvedValue({ ok: true, changed: true, deal: { _id: DEAL_ID, owner_id: OWNER_ID } });
    const response = await as(role, request(app).patch(`/deals/${DEAL_ID}/assign`)).send({ owner_id: OWNER_ID });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Deal assigned successfully');
    expect(assignDealOwner).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: DEAL_ID, ownerId: OWNER_ID, actorId: USER_ID })
    );
  });

  it('unassigns with owner_id null', async () => {
    (assignDealOwner as jest.Mock).mockResolvedValue({ ok: true, changed: true, deal: { _id: DEAL_ID } });
    const response = await as('admin', request(app).patch(`/deals/${DEAL_ID}/assign`)).send({ owner_id: null });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Deal unassigned successfully');
    expect(assignDealOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
  });

  it('passes through service errors such as an owner outside the org', async () => {
    (assignDealOwner as jest.Mock).mockResolvedValue({ ok: false, status: 400, message: 'bad owner' });
    const response = await as('admin', request(app).patch(`/deals/${DEAL_ID}/assign`)).send({ owner_id: OWNER_ID });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('bad owner');
  });
});

describe('/org/assignment-settings', () => {
  it('returns the current mode, defaulting to auto', async () => {
    (Organization.findById as jest.Mock).mockReturnValue(lean({}));
    const response = await as('sales_rep', request(app).get('/org/assignment-settings'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ assignment_mode: 'auto' });
  });

  it('only admins can flip the switch', async () => {
    const response = await as('sales_manager', request(app).patch('/org/assignment-settings')).send({ assignment_mode: 'manual' });
    expect(response.status).toBe(403);
  });

  it('rejects unknown modes', async () => {
    const response = await as('admin', request(app).patch('/org/assignment-settings')).send({ assignment_mode: 'sometimes' });
    expect(response.status).toBe(400);
  });

  it('saves the new mode', async () => {
    (Organization.findByIdAndUpdate as jest.Mock).mockReturnValue(lean({ assignment_mode: 'manual' }));
    const response = await as('admin', request(app).patch('/org/assignment-settings')).send({ assignment_mode: 'manual' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ assignment_mode: 'manual' });
    expect(Organization.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { assignment_mode: 'manual' } },
      expect.anything()
    );
  });
});

describe('routeNewLead honours the assignment switch', () => {
  const contact = {
    _id: new mongoose.Types.ObjectId(),
    organization_id: new mongoose.Types.ObjectId(ORG_ID),
    first_name: 'Ada',
    last_name: 'Lovelace'
  } as never;
  const dealId = new mongoose.Types.ObjectId(DEAL_ID);
  const repId = new mongoose.Types.ObjectId(OWNER_ID);

  beforeEach(() => {
    (RoutingRule.find as jest.Mock).mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
    (User.find as jest.Mock).mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: repId }]) }) });
    (Contact.aggregate as jest.Mock).mockResolvedValue([]);
  });

  it('auto mode gives the lead and its deal to a rep', async () => {
    (Organization.findById as jest.Mock).mockReturnValue(lean({ assignment_mode: 'auto' }));
    const outcome = await routeNewLead(contact, {}, { dealId });
    expect(outcome.owner_id?.toString()).toBe(OWNER_ID);
    expect(outcome.mode).toBe('balanced');
    expect(Deal.updateOne).toHaveBeenCalled();
  });

  it('manual mode leaves the lead and its deal unassigned', async () => {
    (Organization.findById as jest.Mock).mockReturnValue(lean({ assignment_mode: 'manual' }));
    const outcome = await routeNewLead(contact, {}, { dealId });
    expect(outcome.owner_id).toBeNull();
    expect(outcome.mode).toBe('manual');
    expect(User.find).not.toHaveBeenCalled();
    expect(Deal.updateOne).not.toHaveBeenCalled();
    expect(Contact.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { routing: expect.objectContaining({ mode: 'manual' }) } }
    );
  });
});
