import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';

export const getOrganizationObjectId = (req: AuthRequest): mongoose.Types.ObjectId | null => {
  const organizationId = req.user?.organization_id;
  if (!organizationId || !mongoose.Types.ObjectId.isValid(organizationId)) return null;

  return new mongoose.Types.ObjectId(organizationId);
};

export const requireOrganization = (req: AuthRequest, res: Response): mongoose.Types.ObjectId | null => {
  const organizationId = getOrganizationObjectId(req);
  if (!organizationId) {
    res.status(401).json({ status: false, message: 'Organization context required' });
    return null;
  }

  return organizationId;
};

export const tenantQuery = (req: AuthRequest, res: Response): Record<string, mongoose.Types.ObjectId> | null => {
  const organizationId = requireOrganization(req, res);
  return organizationId ? { organization_id: organizationId } : null;
};

/**
 * Deal visibility: sales reps only see deals assigned to them; every other role sees all
 * deals in the organization. Spread into any Deal query that returns deal records.
 */
export const dealScope = (req: AuthRequest): { owner_id?: mongoose.Types.ObjectId } =>
  req.user?.role === 'sales_rep' && req.user.id && mongoose.Types.ObjectId.isValid(req.user.id)
    ? { owner_id: new mongoose.Types.ObjectId(req.user.id) }
    : {};

/** True when the caller may see this deal (always true for roles without deal scoping) */
export const canViewDeal = async (
  req: AuthRequest,
  organizationId: mongoose.Types.ObjectId,
  dealId: string | mongoose.Types.ObjectId
): Promise<boolean> => {
  const scope = dealScope(req);
  if (!scope.owner_id) return true;
  const { Deal } = await import('../models/Deal');
  return !!(await Deal.exists({ _id: dealId, organization_id: organizationId, ...scope }));
};
