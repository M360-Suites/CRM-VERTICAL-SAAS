/**
 * Authentication routes
 * Handles user registration, login, and profile management
 */
import { Router, type Router as RouterType } from 'express';
import {
  signup,
  login,
  getMe,
  updateMe,
  googleAuth,
  googleCallback,
  forgotPassword,
  verifyOTP,
  resetPassword,
  logout,
  verifyEmail,
  resendVerificationEmail
} from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { authRateLimit } from '../middleware/security';
import { validateBody } from '../middleware/validate';

const router: RouterType = Router();

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Register a new tenant admin
 *     description: Creates a user, creates a company organization, seeds that organization's default sales pipeline, and sends an email verification OTP.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, company_name, full_name]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               company_name:
 *                 type: string
 *               full_name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/signup', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 },
  password: { required: true, type: 'string', minLength: 8, maxLength: 128 },
  company_name: { required: true, type: 'string', maxLength: 160 },
  full_name: { type: 'string', maxLength: 120 }
}), signup);

/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Verify signup email with OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 5
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-email', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 },
  otp: { required: true, type: 'string', minLength: 5, maxLength: 5 }
}), verifyEmail);

/**
 * @swagger
 * /auth/resend-verification-email:
 *   post:
 *     summary: Resend signup email verification OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification code sent
 *       400:
 *         description: Email is already verified
 *       429:
 *         description: Too many verification codes requested
 */
router.post('/resend-verification-email', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 }
}), resendVerificationEmail);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     description: Sets an HttpOnly crm_AT cookie and returns the tenant-scoped user profile. If the email is not verified, crm_IV is set to false and the token is still issued so the frontend can redirect to verification.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful. Unverified users also receive this response with crm_IV=false.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 },
  password: { required: true, type: 'string', minLength: 1, maxLength: 128 }
}), login);

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Get Google OAuth authorization URL
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Auth URL generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *       503:
 *         description: Google OAuth not configured
 */
router.get('/google', googleAuth);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Handle Google OAuth callback
 *     tags: [Auth]
 *     description: Sets auth cookies and redirects to the frontend with auth=success. Tokens are not returned in the redirect URL.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend after setting auth cookies
 */
router.get('/google/callback', googleCallback);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticate, getMe);

/**
 * @swagger
 * /auth/me:
 *   patch:
 *     summary: Update current user profile
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name:
 *                 type: string
 *                 maxLength: 120
 *               avatar_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 */
router.patch('/me', authenticate, updateMe);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Always returns success regardless of whether email exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ForgotPasswordResponse'
 */
router.post('/forgot-password', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 }
}), forgotPassword);

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP code and receive reset token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 5
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifyOTPResponse'
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/verify-otp', authRateLimit, validateBody({
  email: { required: true, type: 'string', maxLength: 254 },
  otp: { required: true, type: 'string', minLength: 5, maxLength: 5 }
}), verifyOTP);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using reset token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resetToken, newPassword]
 *             properties:
 *               resetToken:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResetPasswordResponse'
 *       400:
 *         description: Invalid or expired reset token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/reset-password', authRateLimit, validateBody({
  resetToken: { required: true, type: 'string', maxLength: 128 },
  newPassword: { required: true, type: 'string', minLength: 8, maxLength: 128 }
}), resetPassword);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout and clear auth cookie
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', authenticate, logout);

export default router;
