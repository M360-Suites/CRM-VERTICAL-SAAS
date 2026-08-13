import request from 'supertest';
import { authenticated, mockControllerStub, createApp, mockAuthentication } from './helpers/featureRouteHarness';
jest.mock('../src/middleware/auth', mockAuthentication);
jest.mock('../src/controllers/taskController', () => ({
  listTasks: mockControllerStub('listTasks'), getTaskById: mockControllerStub('getTaskById'), createTask: mockControllerStub('createTask'), updateTask: mockControllerStub('updateTask'),
  deleteTask: mockControllerStub('deleteTask'), getMyTasks: mockControllerStub('getMyTasks'), completeTask: mockControllerStub('completeTask'), getUpcomingTasks: mockControllerStub('getUpcomingTasks')
}));
import taskRoutes from '../src/routes/taskRoutes';
const app = createApp('/tasks', taskRoutes);
describe('tasks API', () => {
  it('requires authentication', async () => expect((await request(app).get('/tasks')).status).toBe(401));
  it.each([
    ['get', '/', 'listTasks'], ['get', '/my', 'getMyTasks'], ['get', '/upcoming', 'getUpcomingTasks'], ['get', '/task-1', 'getTaskById'],
    ['post', '/', 'createTask'], ['patch', '/task-1', 'updateTask'], ['delete', '/task-1', 'deleteTask'], ['post', '/task-1/complete', 'completeTask']
  ] as const)('routes %s %s to %s', async (method, path, handler) => {
    const response = await authenticated((request(app) as any)[method](path));
    expect(response.status).toBe(handler === 'createTask' ? 201 : 200);
    expect(response.body.handler).toBe(handler);
  });
});
