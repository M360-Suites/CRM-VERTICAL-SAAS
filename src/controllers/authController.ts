import { Response, Request, CookieOptions } from 'express';
import mongoose from 'mongoose';
import { google } from 'googleapis';
import crypto from 'crypto';
import { User, IUser, UserRole } from '../models/User';
import { Organization } from '../models/Organization';
import { PasswordResetOtp } from '../models/PasswordResetOtp';
import { EmailVerificationOtp } from '../models/EmailVerificationOtp';
import { generateToken } from '../utils/jwt';
import { AuthRequest } from '../types';
import config from '../config';
import { sendEmailVerificationOTP, sendOTPEmail } from '../utils/email';
import { seedDefaultPipelineForOrganization } from '../seeds/pipelineSeed';
import { requireOrganization } from '../utils/tenant';
import { ensureUserOrganization, makeOrganizationSlug } from '../utils/organization';
import { getFrontendUrl } from '../utils/frontend';

const COOKIE_NAMES = {
  ACCESS_TOKEN: 'crm_AT',
  ACCESS_TOKEN_EXPIRY: 'crm_AT_EXPIRY',
  IS_VERIFIED: 'crm_IV',
  LOGGED_IN_USER: 'crm_USER'
} as const;

const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000
};

const FRONTEND_COOKIE_OPTIONS: CookieOptions = {
  ...COOKIE_OPTIONS,
  httpOnly: false
};

const getTokenExpiry = (token: string): number => {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
  return payload.exp ? payload.exp * 1000 : Date.now() + (COOKIE_OPTIONS.maxAge ?? 0);
};

const getCookieUser = (user: IUser) => ({
  id: user._id,
  email: user.email,
  display_name: user.display_name,
  avatar_url: user.avatar_url,
  role: user.role,
  organization_id: user.organization_id,
  created_at: user.created_at
});

const setVerificationCookie = (res: Response, isVerified: boolean): void => {
  res.cookie(COOKIE_NAMES.IS_VERIFIED, String(isVerified), FRONTEND_COOKIE_OPTIONS);
};

const setAuthCookies = (res: Response, token: string, user: IUser): void => {
  res.cookie(COOKIE_NAMES.ACCESS_TOKEN, token, COOKIE_OPTIONS);
  res.cookie(COOKIE_NAMES.ACCESS_TOKEN_EXPIRY, String(getTokenExpiry(token)), FRONTEND_COOKIE_OPTIONS);
  setVerificationCookie(res, user.is_active);
  res.cookie(COOKIE_NAMES.LOGGED_IN_USER, JSON.stringify(getCookieUser(user)), FRONTEND_COOKIE_OPTIONS);
};

const clearAuthCookies = (res: Response): void => {
  Object.values(COOKIE_NAMES).forEach((cookieName) => {
    res.clearCookie(cookieName, FRONTEND_COOKIE_OPTIONS);
  });

  res.clearCookie('token', COOKIE_OPTIONS);
  res.clearCookie('crm_iv', FRONTEND_COOKIE_OPTIONS);
};

const getOAuth2Client = () => {
  const oauth2 = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );
  return oauth2;
};

const hashOtp = (otp: string): string => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

const hashResetToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const normalizeEmail = (email?: string): string | null => {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
};

const createOtp = (): string => {
  return crypto.randomInt(10000, 100000).toString();
};

const createVerificationOtp = async (user: IUser): Promise<boolean> => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await EmailVerificationOtp.countDocuments({
    user_id: user._id,
    created_at: { $gt: oneHourAgo }
  });

  if (recentCount >= 3) {
    return false;
  }

  const otp = createOtp();

  await EmailVerificationOtp.updateMany(
    { user_id: user._id, used_at: null },
    { $set: { used_at: new Date() } }
  );

  await EmailVerificationOtp.create({
    user_id: user._id,
    otp_hash: hashOtp(otp),
    expires_at: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendEmailVerificationOTP(user.email, otp);
  return true;
};

interface SignupBody {
  email: string;
  password: string;
  company_name?: string;
  full_name?: string;
  display_name?: string;
}

export const signup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, company_name, full_name, display_name } = req.body as SignupBody;
    const normalizedEmail = normalizeEmail(email);
    const normalizedCompanyName = (company_name || '').trim();
    const normalizedFullName = (full_name || display_name || '').trim();

    if (!normalizedEmail || !password) {
      res.status(400).json({
        status: false,
        message: 'Email and password are required'
      });
      return;
    }

    if (!normalizedCompanyName) {
      res.status(400).json({
        status: false,
        message: 'Company name is required'
      });
      return;
    }

    if (!normalizedFullName) {
      res.status(400).json({
        status: false,
        message: 'Full name is required'
      });
      return;
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      res.status(400).json({
        status: false,
        message: 'Email already registered'
      });
      return;
    }

    const role: UserRole = 'admin';
    const organization = await Organization.create({
      name: normalizedCompanyName,
      slug: `${makeOrganizationSlug(normalizedCompanyName)}-${crypto.randomBytes(3).toString('hex')}`
    });

    const user = new User({
      email: normalizedEmail,
      password,
      display_name: normalizedFullName,
      role,
      organization_id: organization._id,
      is_active: false
    });

    await user.save();
    organization.owner_id = user._id as mongoose.Types.ObjectId;
    await organization.save();
    await seedDefaultPipelineForOrganization(organization._id as mongoose.Types.ObjectId);
    const verificationEmailSent = await createVerificationOtp(user);

    setVerificationCookie(res, false);

    res.status(201).json({
      status: true,
      message: verificationEmailSent
        ? 'User registered successfully. Check your email for a verification code.'
        : 'User registered successfully, but too many verification codes were requested recently. Try again later.',
      data: {}
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to create user'
    });
  }
};

interface VerifyEmailBody {
  email: string;
  otp: string;
}

export const verifyEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body as VerifyEmailBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !otp) {
      res.status(400).json({
        status: false,
        message: 'Email and OTP are required'
      });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    if (user.is_active) {
      setVerificationCookie(res, true);
      res.json({
        status: true,
        message: 'Email already verified',
        data: {}
      });
      return;
    }

    const otpRecord = await EmailVerificationOtp.findOne({
      user_id: user._id,
      used_at: null,
      expires_at: { $gt: new Date() }
    }).sort({ created_at: -1 });

    if (!otpRecord) {
      setVerificationCookie(res, false);
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    if (otpRecord.attempts >= 5) {
      otpRecord.used_at = new Date();
      await otpRecord.save();
      setVerificationCookie(res, false);
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    if (otpRecord.otp_hash !== hashOtp(otp)) {
      otpRecord.attempts += 1;
      if (otpRecord.attempts >= 5) {
        otpRecord.used_at = new Date();
      }
      await otpRecord.save();
      setVerificationCookie(res, false);
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    user.is_active = true;
    await user.save();

    otpRecord.used_at = new Date();
    await otpRecord.save();

    const organizationId = await ensureUserOrganization(user);

    const token = generateToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      organization_id: organizationId.toString()
    });

    setAuthCookies(res, token, user);

    res.json({
      status: true,
      message: 'Email verified successfully',
      data: {}
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to verify email'
    });
  }
};

interface ResendVerificationEmailBody {
  email: string;
}

export const resendVerificationEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body as ResendVerificationEmailBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
      res.status(400).json({
        status: false,
        message: 'Email is required'
      });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (user?.is_active) {
      setVerificationCookie(res, true);
      res.status(400).json({
        status: false,
        message: 'Email is already verified'
      });
      return;
    }

    if (user) {
      setVerificationCookie(res, false);
      const verificationEmailSent = await createVerificationOtp(user);

      if (!verificationEmailSent) {
        res.status(429).json({
          status: false,
          message: 'Too many verification codes requested. Please try again later.'
        });
        return;
      }
    }

    res.json({
      status: true,
      message: 'Verification code sent to your email',
      data: {}
    });
  } catch (error) {
    console.error('Resend verification email error:', error);
    res.json({
      status: true,
      message: 'Verification code sent to your email',
      data: {}
    });
  }
};

interface LoginBody {
  email: string;
  password: string;
}

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as LoginBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      res.status(400).json({
        status: false,
        message: 'Email and password are required'
      });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      res.status(401).json({
        status: false,
        message: 'Invalid credentials'
      });
      return;
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      res.status(401).json({
        status: false,
        message: 'Invalid credentials'
      });
      return;
    }

    const organizationId = await ensureUserOrganization(user);

    const token = generateToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      organization_id: organizationId.toString()
    });

    setAuthCookies(res, token, user);

    if (!user.is_active) {
      res.json({
        status: true,
        message: 'Please verify your email before continuing',
        data: {
          user: {
            id: user._id,
            email: user.email,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            role: user.role,
            organization_id: user.organization_id,
            is_verified: false,
            created_at: user.created_at
          }
        }
      });
      return;
    }

    res.json({
      status: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          display_name: user.display_name,
          avatar_url: user.avatar_url,
          role: user.role,
          organization_id: user.organization_id,
          is_verified: true,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to login'
    });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: req.user?.id, organization_id: organizationId }).select('-password');

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({
      status: true,
      message: 'User profile retrieved successfully',
      data: {
        id: user._id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
        organization_id: user.organization_id,
        created_at: user.created_at
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch user'
    });
  }
};

interface UpdateMeBody {
  display_name?: string;
  avatar_url?: string;
}

export const updateMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { display_name, avatar_url } = req.body as UpdateMeBody;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOneAndUpdate(
      { _id: req.user?.id, organization_id: organizationId },
      { $set: { display_name, avatar_url } },
      { new: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({
      status: true,
      message: 'Profile updated successfully',
      data: {
        id: user._id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role,
        organization_id: user.organization_id,
        created_at: user.created_at
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update user'
    });
  }
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      res.status(503).json({
        status: false,
        message: 'Google OAuth not configured'
      });
      return;
    }

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]
    });

    res.json({ status: true, message: 'Auth URL generated successfully', data: { url: authUrl } });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to generate auth URL'
    });
  }
};

export const googleCallback = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      res.status(400).json({
        status: false,
        message: 'Missing authorization code'
      });
      return;
    }

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const userInfo = await google.oauth2('v2').userinfo.get({ auth: oauth2Client });

    if (!userInfo.data || !userInfo.data.email) {
      res.status(400).json({
        status: false,
        message: 'Invalid token'
      });
      return;
    }

    const email = userInfo.data.email;
    const displayName = userInfo.data.name || email.split('@')[0];

    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      const role: UserRole = 'admin';
      const organization = await Organization.create({
        name: displayName,
        slug: `${makeOrganizationSlug(displayName)}-${crypto.randomBytes(3).toString('hex')}`
      });

      user = new User({
        email: email.toLowerCase(),
        password: Math.random().toString(36).slice(-16),
        display_name: displayName,
        avatar_url: userInfo.data.picture,
        role,
        organization_id: organization._id,
        is_active: true
      });

      await user.save();
      organization.owner_id = user._id as mongoose.Types.ObjectId;
      await organization.save();
      await seedDefaultPipelineForOrganization(organization._id as mongoose.Types.ObjectId);
    }

    const organizationId = await ensureUserOrganization(user);

    const token = generateToken({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      organization_id: organizationId.toString()
    });

    setAuthCookies(res, token, user);

    const redirectUrl = `${getFrontendUrl()}?auth=success`;

    res.redirect(redirectUrl);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to complete Google auth'
    });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  clearAuthCookies(res);
  res.json({ status: true, message: 'Logged out successfully' });
};

interface ForgotPasswordBody {
  email: string;
}

export const forgotPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email } = req.body as ForgotPasswordBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
      res.status(400).json({
        status: false,
        message: 'Email is required'
      });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (user) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await PasswordResetOtp.countDocuments({
        user_id: user._id,
        created_at: { $gt: oneHourAgo }
      });

      if (recentCount >= 3) {
        res.json({
          status: true,
          message: 'OTP sent to your email',
          data: {}
        });
        return;
      }

      const otp = createOtp();
      const otpHash = hashOtp(otp);

      await PasswordResetOtp.updateMany(
        { user_id: user._id, used_at: null },
        { $set: { used_at: new Date() } }
      );

      await PasswordResetOtp.create({
        user_id: user._id,
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      });

      await sendOTPEmail(user.email, otp);
    }

    res.json({
      status: true,
      message: 'OTP sent to your email',
      data: {}
    });
  } catch (error) {
    console.error('Forgot password OTP error:', error);
    res.json({
      status: true,
      message: 'OTP sent to your email',
      data: {}
    });
  }
};

interface VerifyOTPBody {
  email: string;
  otp: string;
}

export const verifyOTP = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body as VerifyOTPBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !otp) {
      res.status(400).json({
        status: false,
        message: 'Email and OTP are required'
      });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail }).select('_id');
    if (!user) {
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    const otpRecord = await PasswordResetOtp.findOne({
      user_id: user._id,
      used_at: null,
      expires_at: { $gt: new Date() }
    }).sort({ created_at: -1 });

    if (!otpRecord) {
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    if (otpRecord.attempts >= 5) {
      otpRecord.used_at = new Date();
      await otpRecord.save();
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    if (otpRecord.otp_hash !== hashOtp(otp)) {
      otpRecord.attempts += 1;
      if (otpRecord.attempts >= 5) {
        otpRecord.used_at = new Date();
      }
      await otpRecord.save();
      res.status(400).json({
        status: false,
        message: 'Invalid or expired OTP'
      });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    otpRecord.reset_token_hash = hashResetToken(resetToken);
    otpRecord.reset_token_expires_at = new Date(Date.now() + 5 * 60 * 1000);
    await otpRecord.save();

    res.json({
      status: true,
      message: 'OTP verified successfully',
      data: { resetToken }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to verify OTP'
    });
  }
};

interface ResetPasswordBody {
  resetToken: string;
  newPassword: string;
}

export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { resetToken, newPassword } = req.body as ResetPasswordBody;

    if (!resetToken || !newPassword) {
      res.status(400).json({
        status: false,
        message: 'Reset token and new password are required'
      });
      return;
    }

    const otpRecord = await PasswordResetOtp.findOne({
      reset_token_hash: hashResetToken(resetToken),
      used_at: null,
      reset_token_expires_at: { $gt: new Date() }
    });

    if (!otpRecord) {
      res.status(400).json({
        status: false,
        message: 'Invalid or expired reset token'
      });
      return;
    }

    const user = await User.findById(otpRecord.user_id);
    if (!user) {
      res.status(400).json({
        status: false,
        message: 'Invalid or expired reset token'
      });
      return;
    }

    user.password = newPassword;
    await user.save();

    otpRecord.used_at = new Date();
    await otpRecord.save();

    res.json({
      status: true,
      message: 'Password reset successfully',
      data: {}
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to reset password'
    });
  }
};
