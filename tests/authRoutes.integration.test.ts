import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

const findOne = jest.fn();
const findOneAndUpdate = jest.fn();
const findById = jest.fn();
const saveUser = jest.fn();
const createOrganization = jest.fn();
const saveOrganization = jest.fn();
const countDocuments = jest.fn();
const updateMany = jest.fn();
const createOtp = jest.fn();
const findEmailOtp = jest.fn();
const findPasswordOtp = jest.fn();
const sendVerification = jest.fn();
const sendPasswordOtp = jest.fn();
const seedPipeline = jest.fn();
const generateToken = jest.fn();
const ensureUserOrganization = jest.fn();
const requireOrganization = jest.fn();

jest.mock('../src/models/User', () => ({
  User: Object.assign(jest.fn().mockImplementation((data) => ({ ...data, _id: 'user-1', save: saveUser })), {
    findOne,
    findOneAndUpdate,
    findById
  })
}));
jest.mock('../src/models/Organization', () => ({ Organization: { create: createOrganization } }));
jest.mock('../src/models/EmailVerificationOtp', () => ({
  EmailVerificationOtp: { countDocuments, updateMany, create: createOtp, findOne: findEmailOtp }
}));
jest.mock('../src/models/PasswordResetOtp', () => ({ PasswordResetOtp: { countDocuments, updateMany, create: createOtp, findOne: findPasswordOtp } }));
jest.mock('../src/utils/email', () => ({ sendEmailVerificationOTP: sendVerification, sendOTPEmail: sendPasswordOtp }));
jest.mock('../src/seeds/pipelineSeed', () => ({ seedDefaultPipelineForOrganization: seedPipeline }));
jest.mock('../src/utils/organization', () => ({ makeOrganizationSlug: (name: string) => name.toLowerCase(), ensureUserOrganization }));
jest.mock('../src/utils/tenant', () => ({ requireOrganization }));
jest.mock('../src/utils/jwt', () => ({ generateToken }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: unknown }).user = {
      id: 'user-1', email: 'ada@example.com', role: 'admin', organization_id: 'org-1'
    };
    next();
  }
}));
jest.mock('../src/middleware/security', () => ({ authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }));
jest.mock('../src/config', () => ({ __esModule: true, default: {} }));

import authRoutes from '../src/routes/authRoutes';

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('auth HTTP API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockResolvedValue(null);
    createOrganization.mockResolvedValue({ _id: 'org-1', save: saveOrganization });
    saveUser.mockResolvedValue(undefined);
    saveOrganization.mockResolvedValue(undefined);
    countDocuments.mockResolvedValue(0);
    updateMany.mockResolvedValue(undefined);
    createOtp.mockResolvedValue(undefined);
    findEmailOtp.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
    findPasswordOtp.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
    sendVerification.mockResolvedValue(undefined);
    sendPasswordOtp.mockResolvedValue(undefined);
    seedPipeline.mockResolvedValue(undefined);
    ensureUserOrganization.mockResolvedValue('org-1');
    requireOrganization.mockReturnValue('org-1');
    generateToken.mockReturnValue(`header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`);
  });

  it('rejects a short password before the signup controller can create tenant data', async () => {
    const response = await request(app).post('/auth/signup').send({
      email: 'new@example.com', password: 'short', company_name: 'Acme', full_name: 'Ada Lovelace'
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Validation failed', errors: ['password is too short'] });
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('creates a tenant, user, pipeline, and verification OTP through the real signup route', async () => {
    const response = await request(app).post('/auth/signup').send({
      email: '  Ada@Example.com ', password: 'SafePassword1!', company_name: 'Acme', full_name: 'Ada Lovelace'
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: true, message: expect.stringContaining('User registered successfully') });
    expect(findOne).toHaveBeenCalledWith({ email: 'ada@example.com' });
    expect(seedPipeline).toHaveBeenCalledWith('org-1');
    expect(sendVerification).toHaveBeenCalledWith('ada@example.com', expect.stringMatching(/^\d{5}$/));
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('crm_IV=false')]));
  });

  it('logs in an active user through the real HTTP route', async () => {
    const user = {
      _id: 'user-1', email: 'ada@example.com', display_name: 'Ada', avatar_url: null,
      role: 'admin', organization_id: 'org-1', is_active: true,
      comparePassword: jest.fn().mockResolvedValue(true)
    };
    findOne.mockResolvedValueOnce(user);

    const response = await request(app).post('/auth/login').send({ email: 'ada@example.com', password: 'SafePassword1!' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Login successful' });
    expect(user.comparePassword).toHaveBeenCalledWith('SafePassword1!');
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('crm_AT=header.')]));
  });

  it('verifies an email through the real HTTP route', async () => {
    const user = { _id: 'user-1', email: 'ada@example.com', is_active: false, role: 'admin', organization_id: 'org-1', save: saveUser };
    const otpRecord = {
      otp_hash: crypto.createHash('sha256').update('12345').digest('hex'), attempts: 0, used_at: null,
      save: jest.fn().mockResolvedValue(undefined)
    };
    findOne.mockResolvedValueOnce(user);
    findEmailOtp.mockReturnValue({ sort: jest.fn().mockResolvedValue(otpRecord) });

    const response = await request(app).post('/auth/verify-email').send({ email: 'ada@example.com', otp: '12345' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Email verified successfully' });
    expect(saveUser).toHaveBeenCalled();
  });

  it('resends email verification through the real HTTP route', async () => {
    findOne.mockResolvedValueOnce({ _id: 'user-1', email: 'ada@example.com', is_active: false });

    const response = await request(app).post('/auth/resend-verification-email').send({ email: 'ada@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Verification code sent to your email' });
    expect(sendVerification).toHaveBeenCalledWith('ada@example.com', expect.stringMatching(/^\d{5}$/));
  });

  it('gets the current user profile through the real HTTP route', async () => {
    findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: 'user-1', email: 'ada@example.com', display_name: 'Ada', role: 'admin', organization_id: 'org-1' })
    });

    const response = await request(app).get('/auth/me');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, data: { id: 'user-1', email: 'ada@example.com', display_name: 'Ada' } });
  });

  it('updates the current user profile through the real HTTP route', async () => {
    findOneAndUpdate.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: 'user-1', email: 'ada@example.com', display_name: 'Ada Updated', role: 'admin', organization_id: 'org-1' })
    });

    const response = await request(app).patch('/auth/me').send({ display_name: 'Ada Updated' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Profile updated successfully', data: { display_name: 'Ada Updated' } });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'user-1', organization_id: 'org-1' }, { $set: { display_name: 'Ada Updated', avatar_url: undefined } }, { new: true }
    );
  });

  it('reports that Google OAuth is unavailable when its credentials are not configured', async () => {
    const response = await request(app).get('/auth/google');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: false, message: 'Google OAuth not configured' });
  });

  it('rejects an OAuth callback that omits the authorization code', async () => {
    const response = await request(app).get('/auth/google/callback');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ status: false, message: 'Missing authorization code' });
  });

  it('requests a password reset OTP through the real HTTP route', async () => {
    findOne.mockResolvedValueOnce({ _id: 'user-1', email: 'ada@example.com' });

    const response = await request(app).post('/auth/forgot-password').send({ email: 'ada@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'OTP sent to your email' });
    expect(sendPasswordOtp).toHaveBeenCalledWith('ada@example.com', expect.stringMatching(/^\d{5}$/));
  });

  it('rejects an invalid password reset OTP through the real HTTP route', async () => {
    findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1' }) });
    findPasswordOtp.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });

    const response = await request(app).post('/auth/verify-otp').send({ email: 'ada@example.com', otp: '12345' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid or expired OTP' });
  });

  it('issues a reset token for a valid password reset OTP through the real HTTP route', async () => {
    const otpRecord = {
      otp_hash: crypto.createHash('sha256').update('12345').digest('hex'), attempts: 0,
      save: jest.fn().mockResolvedValue(undefined)
    };
    findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-1' }) });
    findPasswordOtp.mockReturnValue({ sort: jest.fn().mockResolvedValue(otpRecord) });

    const response = await request(app).post('/auth/verify-otp').send({ email: 'ada@example.com', otp: '12345' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'OTP verified successfully', data: { resetToken: expect.any(String) } });
    expect(otpRecord.save).toHaveBeenCalled();
  });

  it('rejects an invalid password reset token through the real HTTP route', async () => {
    findPasswordOtp.mockResolvedValueOnce(null);

    const response = await request(app).post('/auth/reset-password').send({ resetToken: 'invalid', newPassword: 'NewPassword1!' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ status: false, message: 'Invalid or expired reset token' });
  });

  it('resets a password through the real HTTP route when the reset token is valid', async () => {
    const otpRecord = { user_id: 'user-1', save: jest.fn().mockResolvedValue(undefined) };
    const user = { password: 'old-password', save: jest.fn().mockResolvedValue(undefined) };
    findPasswordOtp.mockResolvedValueOnce(otpRecord);
    findById.mockResolvedValueOnce(user);

    const response = await request(app).post('/auth/reset-password').send({ resetToken: 'valid-token', newPassword: 'NewPassword1!' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: true, message: 'Password reset successfully' });
    expect(user.password).toBe('NewPassword1!');
    expect(user.save).toHaveBeenCalled();
    expect(otpRecord.save).toHaveBeenCalled();
  });

  it('logs out through the real authenticated HTTP route', async () => {
    const response = await request(app).post('/auth/logout');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: true, message: 'Logged out successfully' });
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('crm_AT=;')]));
  });
});
