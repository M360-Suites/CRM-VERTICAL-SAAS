import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'admin' };
    next();
  }, authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
import companyRoutes from '../src/routes/companyRoutes';
const app = express(); app.use(express.json()); app.use('/companies', companyRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');
describe('companies API', () => {
  it('requires authentication', async () => expect((await request(app).get('/companies')).status).toBe(401));
  it('rejects invalid company IDs', async () => {
    const response = await authenticated(request(app).get('/companies/not-an-object-id'));
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Invalid company ID' });
  });

  it.each([
    ['patch', (id: string) => request(app).patch(`/companies/${id}`)],
    ['delete', (id: string) => request(app).delete(`/companies/${id}`)],
    ['contacts', (id: string) => request(app).get(`/companies/${id}/contacts`)],
    ['deals', (id: string) => request(app).get(`/companies/${id}/deals`)],
    ['stats', (id: string) => request(app).get(`/companies/${id}/stats`)]
  ])('rejects an invalid company ID for %s requests', async (_operation, makeRequest) => {
    const response = await authenticated(makeRequest('not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid company ID' });
  });

  it('rejects a bulk import with no uploaded CSV', async () => {
    const response = await authenticated(request(app).post('/companies/bulk-import'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'CSV file is required' });
  });
});
