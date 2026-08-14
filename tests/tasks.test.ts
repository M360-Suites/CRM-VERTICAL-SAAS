import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'sales_rep' };
    next();
  },
  authorize: (...roles: string[]) => (req: Request & { user?: { role: string } }, res: Response, next: NextFunction) => roles.includes(req.user?.role || '') ? next() : void res.status(403).json({ status: false })
}));

import taskRoutes from '../src/routes/taskRoutes';

const app = express();
app.use(express.json());
app.use('/tasks', taskRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

describe('tasks API', () => {
  it('requires authentication', async () => expect((await request(app).get('/tasks')).status).toBe(401));

  it('rejects invalid task IDs before querying the database', async () => {
    const response = await authenticated(request(app).get('/tasks/not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid task ID' });
  });

  it('enforces delete authorization at the API boundary', async () => {
    const response = await authenticated(request(app).delete('/tasks/507f1f77bcf86cd799439011'));
    expect(response.status).toBe(403);
  });
});
