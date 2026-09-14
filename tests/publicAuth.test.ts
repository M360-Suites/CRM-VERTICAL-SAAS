import express from 'express';
import request from 'supertest';

const findOne = jest.fn();

jest.mock('../src/models/Organization', () => ({
  Organization: { findOne }
}));

import { authenticatePublicKey } from '../src/middleware/publicAuth';

const app = express();
app.use(express.json());
app.post('/auth-header', authenticatePublicKey, (_req, res) => res.json({ status: true }));
app.get('/no-body', authenticatePublicKey, (_req, res) => res.json({ status: true }));

describe('authenticatePublicKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: 'org-1',
        name: 'Org 1',
        slug: 'org-1',
        is_active: true,
        publicKey: 'pk_live_test'
      })
    });
  });

  it('accepts the key from the x-api-key header on a GET request with no body', async () => {
    const response = await request(app).get('/no-body').set('x-api-key', 'pk_live_test');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
    expect(findOne).toHaveBeenCalledWith({ publicKey: 'pk_live_test', is_active: true });
  });

  it('accepts the key from the request body', async () => {
    const response = await request(app)
      .post('/auth-header')
      .send({ key: 'pk_live_test' })
      .set('Content-Type', 'application/json');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(true);
  });

  it('rejects a request with no key', async () => {
    const response = await request(app).get('/no-body');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('API key is required');
    expect(findOne).not.toHaveBeenCalled();
  });
});