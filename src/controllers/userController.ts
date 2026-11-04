/**
 * User management controller
 * Handles admin operations on users
 */
import { Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { User, IUser, UserRole } from '../models/User';
import { Organization } from '../models/Organization';
import { UserInvitation } from '../models/UserInvitation';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';
import { sendUserInvitationEmail, sendWelcomeEmail } from '../utils/email';
import { logger } from '../config/logger';
import { getFrontendUrl } from '../utils/frontend';
import { handleError, AppError } from '../utils/errorHandler';
import { Deal } from '../models/Deal';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { Task } from '../models/Task';
import { CRMFile } from '../models/Document';
import { Folder } from '../models/Folder';
import { PipelineStage } from '../models/Pipeline';
import { RoutingRule } from '../models/RoutingRule';
import { Notification } from '../models/Notification';
import { SocialAccount } from '../models/SocialAccount';
import { EmailMessage } from '../models/EmailMessage';
import { PasswordResetOtp } from '../models/PasswordResetOtp';
import { EmailVerificationOtp } from '../models/EmailVerificationOtp';

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
  invitationToken?: string;
  token?: string;
  password: string;
  display_name?: string;
}

interface UpdateUserBody {
  display_name?: string;
  avatar_url?: string | null;
  role?: UserRole;
  is_active?: boolean;
}

const validRoles: UserRole[] = ['admin', 'sales_manager', 'sales_rep', 'viewer'];

const hashInviteToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const normalizeEmail = (email?: string): string | null => {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
};

const getInviteAcceptUrl = (token: string, displayName?: string): string => {
  const params = new URLSearchParams({ invitationToken: token });
  const normalizedDisplayName = displayName?.trim();

  if (normalizedDisplayName) {
    params.set('display_name', normalizedDisplayName);
  }

  return `${getFrontendUrl(process.env.FRONTEND_INVITE_URL)}/accept-invite?${params.toString()}`;
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
    handleError(res, error, 'Failed to fetch users');
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
    handleError(res, error, 'Failed to fetch user');
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
    handleError(res, error, 'Failed to create user');
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { display_name, avatar_url, role, is_active } = req.body as UpdateUserBody;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ status: false, message: 'Invalid user ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const update: Record<string, unknown> = {};

    if (display_name !== undefined) {
      const normalizedDisplayName = display_name.trim();
      if (!normalizedDisplayName) {
        res.status(400).json({ status: false, message: 'display_name cannot be empty' });
        return;
      }
      update.display_name = normalizedDisplayName;
    }

    if (avatar_url !== undefined) {
      update.avatar_url = avatar_url || null;
    }

    if (role !== undefined) {
      if (!validRoles.includes(role)) {
        res.status(400).json({ status: false, message: 'Invalid role' });
        return;
      }
      update.role = role;
    }

    if (is_active !== undefined) {
      update.is_active = is_active;
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ status: false, message: 'No valid fields provided' });
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: update },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ status: false, message: 'User not found' });
      return;
    }

    res.json({
      status: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    handleError(res, error, 'Failed to update user');
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
      inviteUrl: getInviteAcceptUrl(rawToken, invitation.display_name),
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
    handleError(res, error, 'Failed to invite user');
  }
};

export const listInvitations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const invitations = await UserInvitation.find({
      organization_id: organizationId,
      accepted_at: null,
      revoked_at: null,
      expires_at: { $gt: new Date() }
    })
      .populate('invited_by', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'Invitations retrieved successfully',
      data: invitations
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch invitations');
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
    handleError(res, error, 'Failed to revoke invitation');
  }
};

export const acceptInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { invitationToken, token, password, display_name } = req.body as AcceptInvitationBody;
    const inviteToken = invitationToken || token;

    if (!inviteToken || !password) {
      res.status(400).json({ status: false, message: 'Invitation token and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ status: false, message: 'Password must be at least 8 characters' });
      return;
    }

    const invitation = await UserInvitation.findOne({
      token_hash: hashInviteToken(inviteToken),
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

    // Best effort — a welcome email must never fail the invite acceptance
    void Promise.resolve()
      .then(() => sendWelcomeEmail(user.email, user.display_name))
      .catch((error) =>
      logger.warn({ err: error, userId: String(user._id) }, 'Failed to send welcome email')
    );

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
    handleError(res, error, 'Failed to accept invitation');
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
    handleError(res, error, 'Failed to deactivate user');
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
    handleError(res, error, 'Failed to fetch user role');
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
    handleError(res, error, 'Failed to assign role');
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
    handleError(res, error, 'Failed to remove role');
  }
};

/**
 * Permanently delete a staff member from the organization
 * Records they own (deals, contacts, companies, tasks, documents, folders) are
 * reassigned to `reassign_to` (defaults to the admin performing the delete).
 * Personal data (notifications, connected social accounts, synced Gmail, OTPs)
 * is removed. Historical records (activities, stage messages) are kept.
 */
export const deleteStaff = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const reassignToRaw = (req.body?.reassign_to ?? req.query.reassign_to) as unknown;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, `Invalid staff ID: "${id}" is not a valid ID (24-character hex string)`, 'INVALID_ID');
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    if (!req.user?.id) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    if (id === req.user.id) {
      throw new AppError(
        400,
        'You cannot delete your own account. Ask another admin in your organization to remove you.',
        'BAD_REQUEST'
      );
    }

    const staff = await User.findOne({ _id: id, organization_id: organizationId }).select('email display_name role');
    if (!staff) {
      throw new AppError(404, 'Staff member not found in your organization', 'NOT_FOUND');
    }

    const organization = await Organization.findById(organizationId).select('owner_id').lean();
    if (organization?.owner_id && organization.owner_id.toString() === id) {
      throw new AppError(
        409,
        `${staff.display_name} is the owner of this organization and cannot be deleted. Transfer ownership first.`,
        'CONFLICT'
      );
    }

    let reassignToId = req.user.id;
    if (reassignToRaw !== undefined && reassignToRaw !== null && reassignToRaw !== '') {
      if (typeof reassignToRaw !== 'string' || !mongoose.Types.ObjectId.isValid(reassignToRaw)) {
        throw new AppError(400, `Invalid reassign_to: "${String(reassignToRaw)}" is not a valid user ID`, 'INVALID_ID');
      }
      if (reassignToRaw === id) {
        throw new AppError(400, 'reassign_to cannot be the staff member being deleted', 'BAD_REQUEST');
      }
      reassignToId = reassignToRaw;
    }

    const reassignTo = await User.findOne({ _id: reassignToId, organization_id: organizationId, is_active: true })
      .select('display_name email')
      .lean();
    if (!reassignTo) {
      throw new AppError(
        400,
        'reassign_to must be an active staff member in your organization',
        'BAD_REQUEST'
      );
    }

    const staffObjectId = new mongoose.Types.ObjectId(id);
    const reassignObjectId = new mongoose.Types.ObjectId(reassignToId);
    const orgScope = { organization_id: organizationId };
    const ownedBy = { ...orgScope, owner_id: staffObjectId };
    const toNewOwner = { $set: { owner_id: reassignObjectId } };

    const [deals, contacts, companies, tasks, documents, folders] = await Promise.all([
      Deal.updateMany(ownedBy, toNewOwner),
      Contact.updateMany(ownedBy, toNewOwner),
      Company.updateMany(ownedBy, toNewOwner),
      Task.updateMany(ownedBy, toNewOwner),
      CRMFile.updateMany(ownedBy, toNewOwner),
      Folder.updateMany(ownedBy, toNewOwner)
    ]);

    await Promise.all([
      Task.updateMany({ ...orgScope, assignees: staffObjectId }, { $pull: { assignees: staffObjectId } }),
      PipelineStage.updateMany({ ...orgScope, assignees: staffObjectId }, { $pull: { assignees: staffObjectId } }),
      RoutingRule.updateMany({ ...orgScope, assignee_id: staffObjectId }, { $set: { assignee_id: null } }),
      Folder.updateMany({ ...orgScope, last_modified_by: staffObjectId }, { $set: { last_modified_by: reassignObjectId } }),
      Notification.deleteMany({ userId: staffObjectId }),
      SocialAccount.deleteMany({ userId: staffObjectId }),
      EmailMessage.deleteMany({ user_id: staffObjectId }),
      PasswordResetOtp.deleteMany({ user_id: staffObjectId }),
      EmailVerificationOtp.deleteMany({ user_id: staffObjectId })
    ]);

    await User.deleteOne({ _id: staffObjectId, organization_id: organizationId });

    res.json({
      status: true,
      message: `${staff.display_name} has been removed from your organization. Their records were reassigned to ${reassignTo.display_name}.`,
      data: {
        deleted_user: { id: staff._id, email: staff.email, display_name: staff.display_name, role: staff.role },
        reassigned_to: { id: reassignTo._id, email: reassignTo.email, display_name: reassignTo.display_name },
        reassigned: {
          deals: deals.modifiedCount,
          contacts: contacts.modifiedCount,
          companies: companies.modifiedCount,
          tasks: tasks.modifiedCount,
          documents: documents.modifiedCount,
          folders: folders.modifiedCount
        }
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to delete staff member');
  }
};
