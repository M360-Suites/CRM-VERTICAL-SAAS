import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/contactController', () => ({
  listContacts: mockControllerStub('listContacts'), getAllContacts: mockControllerStub('getAllContacts'), getContactById: mockControllerStub('getContactById'),
  createContact: mockControllerStub('createContact'), updateContact: mockControllerStub('updateContact'), deleteContact: mockControllerStub('deleteContact'),
  getContactActivities: mockControllerStub('getContactActivities'), getContactDeals: mockControllerStub('getContactDeals'), getContactTasks: mockControllerStub('getContactTasks'),
  bulkImportContacts: mockControllerStub('bulkImportContacts'), exportContacts: mockControllerStub('exportContacts')
}));
import contactRoutes from '../src/routes/contactRoutes';
const app = createApp('/contacts', contactRoutes);
describe('contacts API', () => {
  it('requires authentication', async () => expect((await request(app).get('/contacts')).status).toBe(401));
  it.each([
    ['get', '/', 'listContacts'], ['get', '/all', 'getAllContacts'], ['get', '/contact-1', 'getContactById'],
    ['get', '/contact-1/activities', 'getContactActivities'], ['get', '/contact-1/deals', 'getContactDeals'], ['get', '/contact-1/tasks', 'getContactTasks'],
    ['post', '/', 'createContact'], ['patch', '/contact-1', 'updateContact'], ['delete', '/contact-1', 'deleteContact'], ['get', '/export', 'exportContacts']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(handler === 'createContact' ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
});
