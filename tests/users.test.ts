import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';

jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/userController', () => ({
  listUsers: mockControllerStub('listUsers'), getUserById: mockControllerStub('getUserById'), createUser: mockControllerStub('createUser'),
  updateUser: mockControllerStub('updateUser'), inviteUser: mockControllerStub('inviteUser'), listInvitations: mockControllerStub('listInvitations'),
  revokeInvitation: mockControllerStub('revokeInvitation'), acceptInvitation: mockControllerStub('acceptInvitation'), deleteUser: mockControllerStub('deleteUser'),
  getUserRole: mockControllerStub('getUserRole'), assignRole: mockControllerStub('assignRole'), removeRole: mockControllerStub('removeRole')
}));

import userRoutes from '../src/routes/userRoutes';
const app = createApp('/users', userRoutes);

describe('users and invitations API', () => {
  it('accepts an invitation without an existing session', async () => {
    const response = await request(app).post('/users/invitations/accept').send({ token: 'invite-token', password: 'SecurePass123!' });
    expect(response.status).toBe(200);
    expect(response.body.handler).toBe('acceptInvitation');
  });

  it('requires authentication for user management', async () => {
    expect((await request(app).get('/users')).status).toBe(401);
  });

  it('requires the admin role for user management', async () => {
    const response = await authenticated(request(app).get('/users')).set('x-test-role', 'sales_manager');
    expect(response.status).toBe(403);
  });

  it.each([
    ['get', '/', 'listUsers'], ['get', '/user-1', 'getUserById'], ['post', '/', 'createUser'], ['patch', '/user-1', 'updateUser'], ['delete', '/user-1', 'deleteUser'],
    ['get', '/invitations', 'listInvitations'], ['post', '/invitations', 'inviteUser'], ['delete', '/invitations/invite-1', 'revokeInvitation'],
    ['get', '/user-1/role', 'getUserRole'], ['post', '/user-1/role', 'assignRole'], ['delete', '/user-1/role', 'removeRole']
  ] as const)('routes admin %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(handler === 'createUser' ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
});
