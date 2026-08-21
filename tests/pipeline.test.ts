import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'admin' }; next();
  }, authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
import pipelineRoutes from '../src/routes/pipelineRoutes';
const app = express(); app.use(express.json()); app.use('/pipeline', pipelineRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');
describe('pipeline API', () => {
  it('requires authentication', async () => expect((await request(app).get('/pipeline')).status).toBe(401));
  it('requires a title when creating a pipeline deal', async () => {
    const response = await authenticated(request(app).post('/pipeline/deals')).send({});
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'title is required' });
  });
  it('validates stage assignment IDs', async () => {
    const response = await authenticated(request(app).post('/pipeline/stages/not-an-id/assignees')).send({ user_id: 'not-an-id' });
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Valid stageId and user_id are required' });
  });
});
