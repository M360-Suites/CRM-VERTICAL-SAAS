import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const ORG_ID = '507f1f77bcf86cd799439012';
const REP_ID = '507f1f77bcf86cd799439011';
const OTHER_REP_ID = '507f1f77bcf86cd7994390ff';
const DEAL_ID = '607f1f77bcf86cd799439aaa';

let currentRole = 'sales_rep';

jest.mock('../src/config', () => ({ __esModule: true, default: { JWT_SECRET: 'test-secret' } }));
jest.mock('../src/services/triggerService', () => ({ queueDealTriggers: jest.fn() }));
jest.mock('../src/services/socketService', () => ({ emitNotification: jest.fn(), emitDealStageChanged: jest.fn() }));
jest.mock('../src/services/dealAssignmentService', () => ({ assignDealOwner: jest.fn() }));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: unknown }).user = { id: REP_ID, organization_id: ORG_ID, role: currentRole };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

jest.mock('../src/models/Deal', () => ({
  Deal: { find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn(), exists: jest.fn() }
}));
jest.mock('../src/models/Activity', () => ({ Activity: { find: jest.fn() } }));

import dealRoutes from '../src/routes/dealRoutes';
import { Deal } from '../src/models/Deal';
import { Activity } from '../src/models/Activity';

const app = express();
app.use(express.json());
app.use('/deals', dealRoutes);

/** Thenable stand-in for a mongoose query chain */
const query = (result: unknown) => {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'skip', 'limit', 'lean', 'populate']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
};

const DealMock = Deal as unknown as Record<'find' | 'findOne' | 'countDocuments' | 'exists', jest.Mock>;
const ownerFilter = (mock: jest.Mock) => mock.mock.calls[0][0].owner_id?.toString();

beforeEach(() => {
  jest.clearAllMocks();
  currentRole = 'sales_rep';
  DealMock.find.mockReturnValue(query([]));
  DealMock.countDocuments.mockResolvedValue(0);
  (Activity.find as jest.Mock).mockReturnValue(query([]));
});

describe('deal visibility for sales reps', () => {
  it('lists only the rep’s own deals', async () => {
    await request(app).get('/deals');
    expect(ownerFilter(DealMock.find)).toBe(REP_ID);
    expect(ownerFilter(DealMock.countDocuments)).toBe(REP_ID);
  });

  it('ignores an owner_id filter that asks for someone else’s deals', async () => {
    await request(app).get(`/deals?owner_id=${OTHER_REP_ID}`);
    expect(ownerFilter(DealMock.find)).toBe(REP_ID);
  });

  it('scopes the unpaginated list', async () => {
    await request(app).get('/deals/all');
    expect(ownerFilter(DealMock.find)).toBe(REP_ID);
  });

  it('returns 404 for a deal assigned to someone else', async () => {
    DealMock.findOne.mockReturnValue(query(null));
    const response = await request(app).get(`/deals/${DEAL_ID}`);
    expect(response.status).toBe(404);
    expect(ownerFilter(DealMock.findOne)).toBe(REP_ID);
  });

  it('hides activities of a deal the rep is not assigned to', async () => {
    DealMock.exists.mockResolvedValue(null);
    const response = await request(app).get(`/deals/${DEAL_ID}/activities`);
    expect(response.status).toBe(404);
    expect(Activity.find).not.toHaveBeenCalled();
  });
});

describe.each(['admin', 'sales_manager', 'viewer'])('deal visibility for %s', (role) => {
  it('sees every deal in the organization', async () => {
    currentRole = role;
    await request(app).get('/deals');
    expect(ownerFilter(DealMock.find)).toBeUndefined();
  });
});
