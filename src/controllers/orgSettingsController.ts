import { Response } from 'express';
import { AuthRequest } from '../types';
import { ASSIGNMENT_MODES, AssignmentMode, Organization } from '../models/Organization';
import { generateApiKeys } from '../utils/apiKeys';
import { requireOrganization } from '../utils/tenant';

/**
 * Get the current organization's API keys (public key + secret key)
 * Secret key is only returned to the authenticated admin
 */
export const getApiKeys = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const organization = await Organization.findById(organizationId)
      .select('publicKey secretKey')
      .lean();

    if (!organization) {
      res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    res.json({
      status: true,
      message: 'API keys retrieved successfully',
      data: {
        publicKey: organization.publicKey || null,
        secretKey: organization.secretKey || null
      }
    });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to retrieve API keys'
    });
  }
};

/**
 * Regenerate the public API key
 * This invalidates all existing script tags immediately
 */
export const regeneratePublicKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    const newPublicKey = generateApiKeys().publicKey;
    organization.publicKey = newPublicKey;
    await organization.save();

    res.json({
      status: true,
      message: 'Public key regenerated. stupid boy .',
      data: {
        publicKey: newPublicKey
      }
    });
  } catch (error) {
    console.error('Regenerate public key error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to regenerate public key'
    });
  }
};

/**
 * Regenerate the secret API key (admin only)
 * This invalidates all existing secret-key consumers immediately
 */
export const regenerateSecretKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    const newSecretKey = generateApiKeys().secretKey;
    organization.secretKey = newSecretKey;
    await organization.save();

    res.json({
      status: true,
      message: 'Secret key regenerated.',
      data: {
        secretKey: newSecretKey
      }
    });
  } catch (error) {
    console.error('Regenerate secret key error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to regenerate secret key'
    });
  }
};

/**
 * Revoke an API key (public or secret)
 * Permanently nullifies the key. Existing script tags / consumers immediately stop working.
 * Use the regenerate endpoint if you want a replacement key.
 */
export const revokeKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { type } = req.body as { type?: string };

    if (type !== 'public' && type !== 'secret') {
      res.status(400).json({
        status: false,
        message: "type must be either 'public' or 'secret'"
      });
      return;
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      res.status(404).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    if (type === 'public') {
      organization.publicKey = undefined;
    } else {
      organization.secretKey = undefined;
    }
    await organization.save();

    res.json({
      status: true,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} key revoked successfully.`,
      data: {
        [type]: null
      }
    });
  } catch (error) {
    console.error('Revoke key error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to revoke key'
    });
  }
};

/**
 * Get the organization's lead assignment mode (auto or manual)
 */
export const getAssignmentSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const organization = await Organization.findById(organizationId).select('assignment_mode').lean();
    if (!organization) {
      res.status(404).json({ status: false, message: 'Organization not found' });
      return;
    }

    res.json({
      status: true,
      message: 'Assignment settings retrieved successfully',
      data: { assignment_mode: organization.assignment_mode ?? 'auto' }
    });
  } catch (error) {
    console.error('Get assignment settings error:', error);
    res.status(500).json({ status: false, message: 'Failed to retrieve assignment settings' });
  }
};

/**
 * Switch lead assignment between auto and manual. Admin only.
 */
export const updateAssignmentSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { assignment_mode } = (req.body ?? {}) as { assignment_mode?: unknown };
    if (!ASSIGNMENT_MODES.includes(assignment_mode as AssignmentMode)) {
      res.status(400).json({ status: false, message: "assignment_mode must be 'auto' or 'manual'" });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const organization = await Organization.findByIdAndUpdate(
      organizationId,
      { $set: { assignment_mode } },
      { new: true, runValidators: true }
    )
      .select('assignment_mode')
      .lean();
    if (!organization) {
      res.status(404).json({ status: false, message: 'Organization not found' });
      return;
    }

    res.json({
      status: true,
      message: 'Assignment settings updated successfully',
      data: { assignment_mode: organization.assignment_mode }
    });
  } catch (error) {
    console.error('Update assignment settings error:', error);
    res.status(500).json({ status: false, message: 'Failed to update assignment settings' });
  }
};
