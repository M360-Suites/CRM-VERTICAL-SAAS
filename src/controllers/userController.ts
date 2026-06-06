/**
 * User management controller
 * Handles admin operations on users
 */
import { Response } from 'express';
import crypto from 'crypto';
import { User, IUser, UserRole } from '../models/User';
import { Organization } from '../models/Organization';
import { UserInvitation } from '../models/UserInvitation';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';
import { sendUserInvitationEmail } from '../utils/email';
import { getFrontendUrl } from '../utils/frontend';

/** Request body for creating user */
interface CreateUserBody {
  email: string;
  password: string;
  display_name: string;
  role?: UserRole;
}

interface InviteUserBody {
  email: string;
  display_name?: string;
  role?: UserRole;
}

interface AcceptInvitationBody {
  token: string;
  password: string;
  display_name?: string;
}

const validRoles: UserRole[] = ['admin', 'sales_manager', 'sales_rep', 'viewer'];

const hashInviteToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const normalizeEmail = (email?: string): string | null => {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
};

const getInviteAcceptUrl = (token: string): string => {
  return `${getFrontendUrl(process.env.FRONTEND_INVITE_URL)}/accept-invite?token=${encodeURIComponent(token)}`;
};

/**
 * List all users
 * Returns paginated list of users with optional search
 */
export const listUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };

    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { display_name: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(query)
    ]);

    const response: PaginatedResponse<IUser> = {
      status: true,
      message: 'Users retrieved successfully',
      data: {
        data: users,
        total,
        page: Number(page),
        limit: Number(limit),
        total_pages: Math.ceil(total / Number(limit))
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch users'
    });
  }
};

/**
 * Get user by ID
 * Returns a single user by their unique identifier
 */
export const getUserById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: id, organization_id: organizationId }).select('-password').lean();

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({ status: true, message: 'User retrieved successfully', data: user });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch user'
    });
  }
};

/**
 * Create a new user
 * Admin-only endpoint to create system users
 */
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, display_name, role } = req.body as CreateUserBody;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({
        status: false,
        message: 'Email already registered'
      });
      return;
    }

    const user = new User({
      email: email.toLowerCase(),
      password,
      display_name,
      organization_id: organizationId,
      role: role || 'viewer'
    });

    await user.save();

    res.status(201).json({
      status: true,
      message: 'User created successfully',
      data: {
        id: user._id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        organization_id: user.organization_id,
        created_at: user.created_at
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to create user'
    });
  }
};

export const inviteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, display_name, role = 'viewer' } = req.body as InviteUserBody;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) {
      res.status(400).json({ status: false, message: 'Email is required' });
      return;
    }

    if (!validRoles.includes(role)) {
      res.status(400).json({ status: false, message: 'Invalid role' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    if (!req.user?.id) {
      res.status(401).json({ status: false, message: 'User not authenticated' });
      return;
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      res.status(400).json({ status: false, message: 'Email already registered' });
      return;
    }

    await UserInvitation.updateMany(
      {
        email: normalizedEmail,
        organization_id: organizationId,
        accepted_at: null,
        revoked_at: null
      },
      { $set: { revoked_at: new Date() } }
    );

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await UserInvitation.create({
      email: normalizedEmail,
      display_name: display_name?.trim(),
      role,
      organization_id: organizationId,
      invited_by: req.user.id,
      token_hash: hashInviteToken(rawToken),
      expires_at: expiresAt
    });

    const organization = await Organization.findById(organizationId).select('name').lean();

    await sendUserInvitationEmail(normalizedEmail, {
      organizationName: organization?.name || 'your organization',
      inviterName: req.user.display_name || req.user.email,
      inviteUrl: getInviteAcceptUrl(rawToken),
      role,
      expiresAt
    });

    res.status(201).json({
      status: true,
      message: 'Invitation sent successfully',
      data: {
        id: invitation._id,
        email: invitation.email,
        display_name: invitation.display_name,
        role: invitation.role,
        organization_id: invitation.organization_id,
        expires_at: invitation.expires_at,
        created_at: invitation.created_at
      }
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ status: false, message: 'Failed to invite user' });
  }
};

export const listInvitations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const invitations = await UserInvitation.find({ organization_id: organizationId })
      .populate('invited_by', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'Invitations retrieved successfully',
      data: invitations
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch invitations' });
  }
};

export const revokeInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const invitation = await UserInvitation.findOneAndUpdate(
      {
        _id: id,
        organization_id: organizationId,
        accepted_at: null,
        revoked_at: null
      },
      { $set: { revoked_at: new Date() } },
      { new: true }
    );

    if (!invitation) {
      res.status(404).json({ status: false, message: 'Active invitation not found' });
      return;
    }

    res.json({ status: true, message: 'Invitation revoked successfully' });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to revoke invitation' });
  }
};

export const acceptInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, password, display_name } = req.body as AcceptInvitationBody;

    if (!token || !password) {
      res.status(400).json({ status: false, message: 'Token and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ status: false, message: 'Password must be at least 8 characters' });
      return;
    }

    const invitation = await UserInvitation.findOne({
      token_hash: hashInviteToken(token),
      accepted_at: null,
      revoked_at: null,
      expires_at: { $gt: new Date() }
    });

    if (!invitation) {
      res.status(400).json({ status: false, message: 'Invalid or expired invitation' });
      return;
    }

    const existingUser = await User.findOne({ email: invitation.email });
    if (existingUser) {
      invitation.accepted_at = new Date();
      await invitation.save();
      res.status(400).json({ status: false, message: 'Email already registered' });
      return;
    }

    const user = new User({
      email: invitation.email,
      password,
      display_name: display_name?.trim() || invitation.display_name || invitation.email.split('@')[0],
      role: invitation.role,
      organization_id: invitation.organization_id,
      is_active: true
    });

    await user.save();

    invitation.accepted_at = new Date();
    await invitation.save();

    res.status(201).json({
      status: true,
      message: 'Invitation accepted successfully. You can now log in.',
      data: {
        id: user._id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        organization_id: user.organization_id,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    res.status(500).json({ status: false, message: 'Failed to accept invitation' });
  }
};

/**
 * Deactivate user account
 * Soft-deletes user by setting is_active to false
 */
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { is_active: false },
      { new: true }
    );

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({ status: true, message: 'User deactivated successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to deactivate user'
    });
  }
};

/**
 * Get user's role
 * Returns the role for a specific user
 */
export const getUserRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOne({ _id: id, organization_id: organizationId }).select('role').lean();

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({
      status: true,
      message: 'User role retrieved successfully',
      data: { user_id: id, role: user.role }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch user role'
    });
  }
};

/** Request body for assigning role */
interface AssignRoleBody {
  role: UserRole;
}

/**
 * Assign role to user
 * Updates user's role to specified role
 */
export const assignRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { role } = req.body as AssignRoleBody;

    if (!validRoles.includes(role)) {
      res.status(400).json({
        status: false,
        message: 'Invalid role'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { role },
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
      message: 'Role assigned successfully',
      data: { user_id: id, role: user.role, assigned_at: new Date() }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to assign role'
    });
  }
};

/**
 * Remove user's role
 * Resets user's role to default 'viewer'
 */
export const removeRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const user = await User.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { role: 'viewer' },
      { new: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({
        status: false,
        message: 'User not found'
      });
      return;
    }

    res.json({ status: true, message: 'Role removed successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to remove role'
    });
  }
};
