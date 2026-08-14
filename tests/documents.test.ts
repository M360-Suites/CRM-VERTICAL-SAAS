import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.header('authorization')) return void res.status(401).json({ status: false, message: 'No token provided' });
    (req as Request & { user?: unknown }).user = { id: '507f1f77bcf86cd799439011', organization_id: '507f1f77bcf86cd799439012', role: 'admin' }; next();
  }, authorize: () => (_req: Request, _res: Response, next: NextFunction) => next()
}));
import folderRoutes from '../src/routes/folderRoutes'; import documentRoutes from '../src/routes/documentRoutes';
const app = express(); app.use(express.json()); app.use('/folders', folderRoutes); app.use('/documents', documentRoutes);
const authenticated = (test: request.Test) => test.set('Authorization', 'Bearer test-token');
describe('folders and documents APIs', () => {
  it('requires authentication', async () => expect((await request(app).get('/folders')).status).toBe(401));
  it('validates a folder ID before reading it', async () => {
    const response = await authenticated(request(app).get('/folders/not-an-object-id'));
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Invalid folder ID' });
  });
  it('requires a folder name on creation', async () => {
    const response = await authenticated(request(app).post('/folders')).send({});
    expect(response.status).toBe(400); expect(response.body).toMatchObject({ status: false, message: 'Folder name is required' });
  });
});
