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
const app = express(); app.use(express.json()); app.use('/users', userRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');
describe('users API', () => {
  it('requires authentication for user management', async () => expect((await request(app).get('/users')).status).toBe(401));
  it('requires invitation credentials', async () => {
    const response = await request(app).post('/users/invitations/accept').send({});
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Validation failed' });
  });
});
