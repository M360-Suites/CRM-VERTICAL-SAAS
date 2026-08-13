import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/dealController', () => ({
  listDeals: mockControllerStub('listDeals'), getAllDeals: mockControllerStub('getAllDeals'), getDealById: mockControllerStub('getDealById'), createDeal: mockControllerStub('createDeal'),
  updateDeal: mockControllerStub('updateDeal'), deleteDeal: mockControllerStub('deleteDeal'), getDealActivities: mockControllerStub('getDealActivities'), getDealTasks: mockControllerStub('getDealTasks'),
  getDealStats: mockControllerStub('getDealStats'), updateDealStage: mockControllerStub('updateDealStage'), bulkUpdateStage: mockControllerStub('bulkUpdateStage')
}));
import dealRoutes from '../src/routes/dealRoutes';
const app = createApp('/deals', dealRoutes);
describe('deals API', () => {
  it('requires authentication', async () => expect((await request(app).get('/deals')).status).toBe(401));
  it.each([
    ['get', '/', 'listDeals'], ['get', '/all', 'getAllDeals'], ['get', '/deal-1', 'getDealById'], ['get', '/deal-1/activities', 'getDealActivities'],
    ['get', '/deal-1/tasks', 'getDealTasks'], ['get', '/deal-1/stats', 'getDealStats'], ['post', '/', 'createDeal'], ['patch', '/deal-1', 'updateDeal'],
    ['delete', '/deal-1', 'deleteDeal'], ['patch', '/deal-1/stage', 'updateDealStage'], ['post', '/bulk-stage', 'bulkUpdateStage']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(handler === 'createDeal' ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
});
