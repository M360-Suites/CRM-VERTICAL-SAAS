import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'sales_rep' };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

import dealRoutes from '../src/routes/dealRoutes';

const app = express();
app.use(express.json());
app.use('/deals', dealRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

describe('deals API', () => {
  it('requires authentication', async () => expect((await request(app).get('/deals')).status).toBe(401));

  it('rejects invalid deal IDs before querying the database', async () => {
    const response = await authenticated(request(app).get('/deals/not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid deal ID' });
  });

  it('validates deal references before writing a deal', async () => {
    const response = await authenticated(request(app).post('/deals')).send({ title: 'New deal', stage_id: 'bad-id' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid stage ID' });
  });
});
