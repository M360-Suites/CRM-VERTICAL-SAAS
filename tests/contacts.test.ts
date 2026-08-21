import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';


jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'admin' };
    next();
  },
  authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));

import contactRoutes from '../src/routes/contactRoutes';

const app = express();
app.use(express.json());
app.use('/contacts', contactRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');

describe('contacts API', () => {

  //api for getting a contact
  it('validates a contact identifier before querying the database', async () => {
    const response = await authenticated(request(app).get('/contacts/not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid contact ID' });
  });
  it('requires authentication', async () => expect((await request(app).get('/contacts')).status).toBe(401));


  it('validates a contact identifier before querying the database', async () => {
    const response = await authenticated(request(app).get('/contacts/not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid contact ID' });
  });


  it('rejects creation when either required name is missing', async () => {
    for (const body of [{ last_name: 'Lovelace' }, { first_name: 'Ada' }, { first_name: '', last_name: 'Lovelace' }]) {
      const response = await authenticated(request(app).post('/contacts')).send(body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ status: false, message: 'first_name and last_name are required' });
    }
  });

  it('rejects an invalid company reference before creating a contact', async () => {
    const response = await authenticated(request(app).post('/contacts')).send({
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_id: 'not-an-object-id'
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid company ID' });
  });

  it.each([
    ['patch', (id: string) => request(app).patch(`/contacts/${id}`)],
    ['delete', (id: string) => request(app).delete(`/contacts/${id}`)],
    ['activities', (id: string) => request(app).get(`/contacts/${id}/activities`)],
    ['deals', (id: string) => request(app).get(`/contacts/${id}/deals`)],
    ['tasks', (id: string) => request(app).get(`/contacts/${id}/tasks`)]
  ])('rejects an invalid contact ID for %s requests', async (_operation, makeRequest) => {
    const response = await authenticated(makeRequest('not-an-object-id'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid contact ID' });
  });

  it('rejects a bulk import with no uploaded CSV', async () => {
    const response = await authenticated(request(app).post('/contacts/bulk-import'));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'CSV file is required' });
  });
});
