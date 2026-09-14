import { Response } from 'express';
import { PublicKeyRequest } from '../middleware/publicAuth';
import { Site } from '../models/Site';

/**
 * Count how many sites are connected to the public key.
 * Called by the client script itself (script tag / embed) with the public key.
 */
export const countSitesPublic = async (req: PublicKeyRequest, res: Response): Promise<void> => {
  try {
    const organization = req.organization;
    if (!organization) {
      res.status(401).json({
        status: false,
        message: 'Organization not found'
      });
      return;
    }

    const [total, active] = await Promise.all([
      Site.countDocuments({ organization_id: organization._id }),
      Site.countDocuments({ organization_id: organization._id, is_active: true })
    ]);

    res.json({
      status: true,
      message: 'Site count retrieved successfully',
      data: {
        count: total,
        active_count: active,
        inactive_count: total - active
      }
    });
  } catch (error) {
    console.error('Public site count error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to count sites'
    });
  }
};