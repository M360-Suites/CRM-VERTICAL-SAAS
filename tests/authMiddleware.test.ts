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

  it('rejects a session that was signed out by a password reset', async () => {
    verifyToken.mockReturnValue({ id: 'user-1', tv: 0 });
    findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1', role: 'admin', is_active: true, token_version: 1 }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer old-token');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SESSION_REVOKED');
  });

  it('accepts a session issued at the current token version', async () => {
    verifyToken.mockReturnValue({ id: 'user-1', tv: 1 });
    findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1', role: 'admin', is_active: true, token_version: 1 }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer new-token');

    expect(response.status).toBe(200);
  });

  it('tells an unverified sign-up to verify their email, not that they were deactivated', async () => {
    findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1', role: 'admin', is_active: false, deactivated_at: null }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('still reports a deactivated account as deactivated', async () => {
    findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1', role: 'admin', is_active: false, deactivated_at: new Date() }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('rejects a token when its organization has been deactivated', async () => {
    findOrganization.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ is_active: false }) }) });

    const response = await request(app).get('/exports').set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Your organization is inactive. Contact support to reactivate it.');
  });
});
