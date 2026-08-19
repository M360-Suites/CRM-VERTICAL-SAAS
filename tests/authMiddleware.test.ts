import express from 'express';
import request from 'supertest';

const verifyToken = jest.fn();
const findById = jest.fn();
const findOrganization = jest.fn();
const ensureUserOrganization = jest.fn();

jest.mock('../src/utils/jwt', () => ({ verifyToken }));
jest.mock('../src/models/User', () => ({ User: { findById } }));
jest.mock('../src/models/Organization', () => ({ Organization: { findById: findOrganization } }));
jest.mock('../src/utils/organization', () => ({ ensureUserOrganization }));

import { authenticate, authorize } from '../src/middleware/auth';

const app = express();
app.get('/exports', authenticate, authorize('admin', 'sales_manager'), (_req, res) => res.json({ status: true }));

describe('real authentication and authorization middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue({ id: 'user-1' });
    findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1', email: 'rep@example.com', role: 'sales_rep', is_active: true }) });
    ensureUserOrganization.mockResolvedValue('org-1');
    findOrganization.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ is_active: true }) }) });
  });

  it('rejects an otherwise authenticated sales rep at an admin export boundary', async () => {
    const response = await request(app).get('/exports').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/permission/i);
  });

  it('rejects a token when its organization has been deactivated', async () => {
    findOrganization.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ is_active: false }) }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Organization is inactive');
  });
});
