import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/emailSyncController', () => Object.fromEntries('getGmailAuthUrl handleGmailCallback gmailStatus syncGmailInbox disconnectGmail listSyncedMessages createContactFromSender linkMessageToContact'.split(' ').map((name) => [name, mockControllerStub(name)])));
jest.mock('../src/controllers/socialAccountController', () => Object.fromEntries('listSocialAccounts connectSocialAccount handleConnectCallback disconnectSocialAccount'.split(' ').map((name) => [name, mockControllerStub(name)])));
jest.mock('../src/controllers/connectionController', () => ({ getConnectionStatuses: mockControllerStub('getConnectionStatuses') }));
jest.mock('../src/controllers/emailWriterController', () => ({ generateEmailHandler: mockControllerStub('generateEmailHandler'), sendEmailHandler: mockControllerStub('sendEmailHandler') }));
import emailSyncRoutes from '../src/routes/emailSyncRoutes'; import socialAccountRoutes from '../src/routes/socialAccountRoutes'; import connectionRoutes from '../src/routes/connectionRoutes'; import emailWriterRoutes from '../src/routes/emailWriterRoutes';
const app = createApp('/email', emailSyncRoutes); app.use('/social-accounts', socialAccountRoutes); app.use('/connections', connectionRoutes); app.use('/ai', emailWriterRoutes);
describe('integration APIs', () => {
  it.each([
    ['get', '/email/auth', 'getGmailAuthUrl'], ['get', '/email/status', 'gmailStatus'], ['post', '/email/sync', 'syncGmailInbox'], ['delete', '/email/auth/disconnect', 'disconnectGmail'], ['get', '/email/messages', 'listSyncedMessages'], ['post', '/email/messages/message-1/create-contact', 'createContactFromSender'], ['post', '/email/messages/message-1/link', 'linkMessageToContact'],
    ['get', '/social-accounts', 'listSocialAccounts'], ['post', '/social-accounts/connect/linkedin', 'connectSocialAccount'], ['delete', '/social-accounts/account-1', 'disconnectSocialAccount'], ['get', '/connections/status', 'getConnectionStatuses'], ['post', '/ai/email/generate', 'generateEmailHandler']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path)); expect(response.status).toBe(200); expect(response.body.handler).toBe(handler);
  });
  it('allows the social provider callback without user authentication', async () => { const response = await request(app).get('/social-accounts/callback'); expect(response.status).toBe(200); expect(response.body.handler).toBe('handleConnectCallback'); });
});
