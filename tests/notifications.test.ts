import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/notificationController', () => ({ listNotifications: mockControllerStub('listNotifications'), markNotificationRead: mockControllerStub('markNotificationRead'), markAllNotificationsRead: mockControllerStub('markAllNotificationsRead') }));
import notificationRoutes from '../src/routes/notificationRoutes'; const app = createApp('/notifications', notificationRoutes);
describe('notifications API', () => {
  it.each([['get', '/', 'listNotifications'], ['patch', '/read-all', 'markAllNotificationsRead'], ['patch', '/notification-1/read', 'markNotificationRead']] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path)); expect(response.status).toBe(200); expect(response.body.handler).toBe(handler);
  });
});
