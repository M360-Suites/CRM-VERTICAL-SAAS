/**
 * Authentication middleware
 * Handles JWT token verification and user authentication
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyToken } from '../utils/jwt';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { ensureUserOrganization } from '../utils/organization';
import { handleError } from '../utils/errorHandler';

/**
 * Verify JWT token and attach user to request
 * Checks for valid Bearer token in Authorization header
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let token = req.cookies?.crm_AT || req.cookies?.token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      res.status(401).json({
        status: false,
        message: 'Authentication required. No access token was provided — log in, or send an "Authorization: Bearer <token>" header.',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    let decoded: ReturnType<typeof verifyToken>;
    try {
      decoded = verifyToken(token);
    } catch (tokenError) {
      const expired = (tokenError as Error)?.name === 'TokenExpiredError';
      res.status(401).json({
        status: false,
        message: expired
          ? 'Your session has expired. Please log in again.'
          : 'Invalid access token. Please log in again.',
        code: expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED'
      });
      return;
    }

    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      res.status(401).json({
        status: false,
        message: 'The account for this session no longer exists. Please log in again.',
        code: 'UNAUTHORIZED'
      });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({
        status: false,
        message: 'Your account has been deactivated. Contact your organization admin to regain access.',
        code: 'ACCOUNT_DEACTIVATED'
      });
      return;
    }

    const organizationId = await ensureUserOrganization(user);
    const organization = await Organization.findById(organizationId).select('is_active').lean();
    if (!organization?.is_active) {
      res.status(401).json({
        status: false,
        message: 'Your organization is inactive. Contact support to reactivate it.',
        code: 'ORGANIZATION_INACTIVE'
      });
      return;
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      organization_id: organizationId.toString(),
      display_name: user.display_name
    };

    next();
  } catch (error) {
    handleError(res, error, 'Failed to authenticate request');
  }
};

/**
 * Role-based authorization middleware
 * Factory function that returns middleware to check user roles
 * @param roles - Allowed roles for the route
 */
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        status: false,
        message: 'Authentication required'
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        status: false,
        message: `You don't have permission to perform this action. Required role: ${roles.join(' or ')}; your role: ${req.user.role}.`,
        code: 'FORBIDDEN'
      });
      return;
    }

    next();
  };
};
