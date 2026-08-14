import crypto from 'crypto';
import type { Request, Response } from 'express';

const mockUserFindOne = jest.fn();
const mockUserFindOneAndUpdate = jest.fn();
const mockUserFindById = jest.fn();
const mockUserSave = jest.fn();
const mockUserComparePassword = jest.fn();
const mockOrganizationCreate = jest.fn();
const mockEmailOtpCountDocuments = jest.fn();
const mockEmailOtpUpdateMany = jest.fn();
const mockEmailOtpCreate = jest.fn();
const mockEmailOtpFindOne = jest.fn();
const mockPasswordOtpCountDocuments = jest.fn();
const mockPasswordOtpUpdateMany = jest.fn();
const mockPasswordOtpCreate = jest.fn();
const mockPasswordOtpFindOne = jest.fn();
const mockGenerateToken = jest.fn();
const mockSendEmailVerificationOTP = jest.fn();
const mockSendOTPEmail = jest.fn();
const mockSeedDefaultPipeline = jest.fn();
const mockEnsureUserOrganization = jest.fn();
const mockMakeOrganizationSlug = jest.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-'));

jest.mock('../src/models/User', () => {
  const MockUser = jest.fn().mockImplementation((data: any) => ({
    ...data,
    save: mockUserSave,
    comparePassword: mockUserComparePassword
  }));

  return {
    User: Object.assign(MockUser, {
      findOne: mockUserFindOne,
      findOneAndUpdate: mockUserFindOneAndUpdate,
      findById: mockUserFindById,
      __getMockUser: () => MockUser
    })
  };
});

jest.mock('../src/models/Organization', () => ({
  Organization: {
    create: mockOrganizationCreate
  }
}));

jest.mock('../src/models/EmailVerificationOtp', () => ({
  EmailVerificationOtp: {
    countDocuments: mockEmailOtpCountDocuments,
    updateMany: mockEmailOtpUpdateMany,
    create: mockEmailOtpCreate,
    findOne: mockEmailOtpFindOne
  }
}));

jest.mock('../src/models/PasswordResetOtp', () => ({
  PasswordResetOtp: {
    countDocuments: mockPasswordOtpCountDocuments,
    updateMany: mockPasswordOtpUpdateMany,
    create: mockPasswordOtpCreate,
    findOne: mockPasswordOtpFindOne
  }
}));

jest.mock('../src/utils/jwt', () => ({
  generateToken: mockGenerateToken
}));

jest.mock('../src/utils/email', () => ({
  sendEmailVerificationOTP: mockSendEmailVerificationOTP,
  sendOTPEmail: mockSendOTPEmail
}));

jest.mock('../src/seeds/pipelineSeed', () => ({
  seedDefaultPipelineForOrganization: mockSeedDefaultPipeline
}));

jest.mock('../src/utils/tenant', () => ({
  requireOrganization: jest.fn()
}));

jest.mock('../src/utils/organization', () => ({
  ensureUserOrganization: mockEnsureUserOrganization,
  makeOrganizationSlug: mockMakeOrganizationSlug
}));

jest.mock('../src/utils/frontend', () => ({
  getFrontendUrl: jest.fn(() => 'http://frontend.test')
}));

jest.mock('../src/config', () => ({
  __esModule: true,
  default: {
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost/callback'
  }
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn(() => 'https://google.test/auth'),
        getToken: jest.fn(),
        setCredentials: jest.fn()
      }))
    },
    oauth2: jest.fn().mockReturnValue({
      userinfo: {
        get: jest.fn().mockResolvedValue({ data: { email: 'oauth@example.com', name: 'OAuth User' } })
      }
    })
  }
}));


const createMockResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis()
  } as unknown as Response;

  return res;
};


const createMockRequest = (body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => ({
  body,
  query
}) as unknown as Request;

const hashOtp = (otp: string): string => crypto.createHash('sha256').update(otp).digest('hex');
const createSignedToken = (): string => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  return `${header}.${payload}.signature`;
};

const authController = require('../src/controllers/authController');
const { signup, verifyEmail, resendVerificationEmail, login, forgotPassword, verifyOTP, resetPassword, logout } = authController;

describe('auth controller edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateToken.mockReturnValue(createSignedToken());
    mockEnsureUserOrganization.mockResolvedValue('org-id');
    mockSendEmailVerificationOTP.mockResolvedValue(undefined);
    mockSendOTPEmail.mockResolvedValue(undefined);
    mockSeedDefaultPipeline.mockResolvedValue(undefined);
    mockUserSave.mockResolvedValue(undefined);
    mockUserComparePassword.mockResolvedValue(true);
    mockOrganizationCreate.mockResolvedValue({
      _id: 'org-id',
      owner_id: null,
      save: jest.fn().mockResolvedValue(undefined)
    });
    mockEmailOtpCountDocuments.mockResolvedValue(0);
    mockEmailOtpUpdateMany.mockResolvedValue(undefined);
    mockEmailOtpCreate.mockResolvedValue(undefined);
    mockEmailOtpFindOne.mockResolvedValue(null);
    mockPasswordOtpCountDocuments.mockResolvedValue(0);
    mockPasswordOtpUpdateMany.mockResolvedValue(undefined);
    mockPasswordOtpCreate.mockResolvedValue(undefined);
    mockPasswordOtpFindOne.mockResolvedValue(null);
  });

  //test case for signup

  describe('signup', () => {
    it('returns 400 when email or password are missing', async () => {
      const req = createMockRequest({ email: ' ', password: '' });
      const res = createMockResponse();

      await signup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email and password are required' }));
    });

    it('returns 400 when company name is missing', async () => {
      const req = createMockRequest({ email: 'user@example.com', password: 'Secret123!', company_name: '   ', full_name: 'Jane Doe' });
      const res = createMockResponse();

      await signup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Company name is required' }));
    });

    it('returns 400 when full name is missing', async () => {
      const req = createMockRequest({ email: 'user@example.com', password: 'Secret123!', company_name: 'Acme', full_name: '   ' });
      const res = createMockResponse();

      await signup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Full name is required' }));
    });

    it('returns 400 when the email already exists', async () => {
      mockUserFindOne.mockResolvedValueOnce({ email: 'existing@example.com' });
      const req = createMockRequest({ email: 'existing@example.com', password: 'Secret123!', company_name: 'Acme', full_name: 'Jane Doe' });
      const res = createMockResponse();

      await signup(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email already registered' }));
    });

    it('creates the user and sets a verification cookie on success', async () => {
      mockUserFindOne.mockResolvedValueOnce(null);
      mockUserSave.mockResolvedValueOnce(undefined);
      const req = createMockRequest({ email: 'new@example.com', password: 'Secret123!', company_name: 'Acme', full_name: 'Jane Doe' });
      const res = createMockResponse();

      await signup(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.cookie).toHaveBeenCalledWith('crm_IV', 'false', expect.any(Object));
      expect(mockSendEmailVerificationOTP).toHaveBeenCalled();
      expect(mockSeedDefaultPipeline).toHaveBeenCalled();
    });
  });

  //Test cases for verifyEmail
  // describe('verifyEmail', () => {
  //   it('returns 400 when email or otp are missing', async () => {
  //     const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
  //     const res = createMockResponse();

  //     await verifyEmail(req, res);

  //     expect(res.status).toHaveBeenCalledWith(400);
  //     expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email and OTP are required' }));
   // });

    
    it('returns 400 when the user does not exist', async () => {
      mockUserFindOne.mockResolvedValueOnce(null);
      const req = createMockRequest({ email: 'missing@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired OTP' }));
    });

    it('returns success when the email is already verified', async () => {
      mockUserFindOne.mockResolvedValueOnce({ _id: 'user-id', email: 'user@example.com', is_active: true, role: 'admin', organization_id: 'org-id' });
      const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyEmail(req, res);

      expect(res.cookie).toHaveBeenCalledWith('crm_IV', 'true', expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email already verified' }));
    });

    it('returns 400 when no valid otp record exists', async () => {
      mockUserFindOne.mockResolvedValueOnce({ _id: 'user-id', email: 'user@example.com', is_active: false });
      mockEmailOtpFindOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
      const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired OTP' }));
    });

    it('verifies the email and sets auth cookies for a valid otp', async () => {
      const user = { _id: 'user-id', email: 'user@example.com', is_active: false, role: 'admin', organization_id: 'org-id', save: mockUserSave };
      mockUserFindOne.mockResolvedValueOnce(user);
      mockEmailOtpFindOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue({
          otp_hash: hashOtp('12345'),
          attempts: 0,
          save: jest.fn().mockResolvedValue(undefined),
          used_at: null
        })
      });
      mockGenerateToken.mockReturnValue(createSignedToken());
      const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyEmail(req, res);

      expect(mockUserSave).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith('crm_AT', expect.any(String), expect.any(Object));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email verified successfully' }));
    });
  });

  //Test cases for resendVerificationEmail
  describe('resendVerificationEmail', () => {
    it('returns 400 when email is missing', async () => {
      const req = createMockRequest({ email: '' });
      const res = createMockResponse();

      await resendVerificationEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email is required' }));
    });

    it('returns 400 when the email is already verified', async () => {
      mockUserFindOne.mockResolvedValueOnce({ is_active: true });
      const req = createMockRequest({ email: 'verified@example.com' });
      const res = createMockResponse();

      await resendVerificationEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email is already verified' }));
    });

    it('returns 429 when too many verification codes were requested', async () => {
      mockUserFindOne.mockResolvedValueOnce({ is_active: false, email: 'user@example.com' });
      mockEmailOtpCountDocuments.mockResolvedValueOnce(3);
      const req = createMockRequest({ email: 'user@example.com' });
      const res = createMockResponse();

      await resendVerificationEmail(req, res);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Too many verification codes requested. Please try again later.' }));
    });
  });

  describe('login', () => {
    it('returns 400 when email or password are missing', async () => {
      const req = createMockRequest({ email: 'user@example.com', password: '' });
      const res = createMockResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email and password are required' }));
    });

    it('returns 401 when the credentials are invalid', async () => {
      mockUserFindOne.mockResolvedValueOnce({ email: 'user@example.com', comparePassword: jest.fn().mockResolvedValue(false) });
      const req = createMockRequest({ email: 'user@example.com', password: 'wrong' });
      const res = createMockResponse();

      await login(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid credentials' }));
    });

    it('returns a verification warning for unverified users', async () => {
      const user = {
        _id: 'user-id',
        email: 'user@example.com',
        password: 'hash',
        display_name: 'Jane',
        avatar_url: null,
        role: 'admin',
        organization_id: 'org-id',
        is_active: false,
        created_at: new Date(),
        comparePassword: jest.fn().mockResolvedValue(true)
      };
      mockGenerateToken.mockReturnValue(createSignedToken());
      mockUserFindOne.mockResolvedValueOnce(user);
      const req = createMockRequest({ email: 'user@example.com', password: 'Secret123!' });
      const res = createMockResponse();

      await login(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Please verify your email before continuing' }));
      expect(res.cookie).toHaveBeenCalledWith('crm_IV', 'false', expect.any(Object));
    });
  });

  //Test cases for forgotPassword
  describe('forgotPassword', () => {
    it('returns 400 when email is missing', async () => {
      const req = createMockRequest({ email: '' });
      const res = createMockResponse();

      await forgotPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email is required' }));
    });

    it('returns success even when no user exists', async () => {
      mockUserFindOne.mockResolvedValueOnce(null);
      const req = createMockRequest({ email: 'unknown@example.com' });
      const res = createMockResponse();

      await forgotPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'OTP sent to your email' }));
    });

    it('returns success when too many otp requests have already been sent', async () => {
      mockUserFindOne.mockResolvedValueOnce({ _id: 'user-id', email: 'user@example.com' });
      mockPasswordOtpCountDocuments.mockResolvedValueOnce(3);
      const req = createMockRequest({ email: 'user@example.com' });
      const res = createMockResponse();

      await forgotPassword(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'OTP sent to your email' }));
    });
  });

  //Test cases for verifyOTP
  describe('verifyOTP', () => {
    it('returns 400 when email or otp are missing', async () => {
      const req = createMockRequest({ email: 'user@example.com', otp: '' });
      const res = createMockResponse();

      await verifyOTP(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email and OTP are required' }));
    });

    it('returns 400 when the otp is invalid', async () => {
      mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-id' }) });
      mockPasswordOtpFindOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
      const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyOTP(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired OTP' }));
    });

    it('returns a reset token for a valid otp', async () => {
      mockUserFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'user-id' }) });
      mockPasswordOtpFindOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue({
          attempts: 0,
          otp_hash: hashOtp('12345'),
          save: jest.fn().mockResolvedValue(undefined)
        })
      });
      const req = createMockRequest({ email: 'user@example.com', otp: '12345' });
      const res = createMockResponse();

      await verifyOTP(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'OTP verified successfully' }));
    });
  });

  //Test cases for resetPassword
  describe('resetPassword', () => {
    it('returns 400 when reset token or password are missing', async () => {
      const req = createMockRequest({ resetToken: '', newPassword: '' });
      const res = createMockResponse();

      await resetPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Reset token and new password are required' }));
    });

    it('returns 400 when the reset token is invalid', async () => {
      mockPasswordOtpFindOne.mockResolvedValueOnce(null);
      const req = createMockRequest({ resetToken: 'bad-token', newPassword: 'NewSecret123!' });
      const res = createMockResponse();

      await resetPassword(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired reset token' }));
    });

    it('resets the password for a valid token', async () => {
      const otpRecord = { user_id: 'user-id', used_at: null, save: jest.fn().mockResolvedValue(undefined) };
      mockPasswordOtpFindOne.mockResolvedValueOnce(otpRecord);
      mockUserFindById.mockResolvedValueOnce({ _id: 'user-id', save: mockUserSave });
      const req = createMockRequest({ resetToken: 'valid-token', newPassword: 'NewSecret123!' });
      const res = createMockResponse();

      await resetPassword(req, res);

      expect(mockUserSave).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Password reset successfully' }));
    });
  });


  //Test cases for logout
  describe('logout', () => {
    it('clears auth cookies and returns a success payload', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      await logout(req, res);

      expect(res.clearCookie).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Logged out successfully' }));
    });
  });

