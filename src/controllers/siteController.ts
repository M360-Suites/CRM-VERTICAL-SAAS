import { Response } from 'express';
import mongoose from 'mongoose';
import { Site } from '../models/Site';
import { AuthRequest } from '../types';
import { requireOrganization } from '../utils/tenant';

interface SiteQuery {
  page?: number;
  limit?: number;
  search?: string;
}

const normalizeDomain = (raw: string): string => {
  const withoutPath = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] || '';
  let domain = withoutPath.trim().toLowerCase();
  if (domain.startsWith('www.')) domain = domain.slice(4);
  return domain;
};

/**
 * List sites connected to the organization's public key.
 * Paginated, with optional domain search.
 */
export const listSites = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search } = req.query as SiteQuery;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };
    if (search) {
      query.domain = { $regex: search, $options: 'i' };
    }

    const skip = (page - 1) * limit;

    const [sites, total] = await Promise.all([
      Site.find(query)
        .sort({ last_seen_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Site.countDocuments(query)
    ]);

    res.json({
      status: true,
      message: 'Sites retrieved successfully',
      data: sites,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List sites error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to retrieve sites'
    });
  }
};

/**
 * Count sites connected to the organization's public key.
 * This is the primary "how many sites" endpoint.
 */
export const countSites = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const [total, active, autoDetected, manual] = await Promise.all([
      Site.countDocuments({ organization_id: organizationId }),
      Site.countDocuments({ organization_id: organizationId, is_active: true }),
      Site.countDocuments({
        organization_id: organizationId,
        source: { $in: ['header', 'explicit'] }
      }),
      Site.countDocuments({ organization_id: organizationId, source: 'manual' })
    ]);

    res.json({
      status: true,
      message: 'Site count retrieved successfully',
      data: {
        count: total,
        active_count: active,
        inactive_count: total - active,
        auto_detected: autoDetected,
        manual: manual
      }
    });
  } catch (error) {
    console.error('Count sites error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to count sites'
    });
  }
};

/**
 * Manually register a site against the organization's public key.
 */
export const registerSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { domain, is_active = true } = req.body as { domain?: string; is_active?: boolean };

    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      res.status(400).json({
        status: false,
        message: 'Domain is required'
      });
      return;
    }

    const normalized = normalizeDomain(domain);
    if (!normalized) {
      res.status(400).json({
        status: false,
        message: 'Invalid domain'
      });
      return;
    }

    let site = await Site.findOne({ organization_id: organizationId, domain: normalized });
    if (site) {
      site.source = 'manual';
      site.is_active = is_active !== false;
      await site.save();
    } else {
      const now = new Date();
      site = await Site.create({
        organization_id: organizationId,
        domain: normalized,
        source: 'manual',
        is_active: is_active !== false,
        request_count: 0,
        first_seen_at: now,
        last_seen_at: now
      });
    }

    res.status(201).json({
      status: true,
      message: 'Site registered successfully',
      data: site
    });
  } catch (error) {
    console.error('Register site error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to register site'
    });
  }
};

/**
 * Update a site (activate / deactivate, or change source).
 */
export const updateSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid site id'
      });
      return;
    }

    const site = await Site.findOne({ _id: id, organization_id: organizationId });
    if (!site) {
      res.status(404).json({
        status: false,
        message: 'Site not found'
      });
      return;
    }

    const { is_active } = req.body as { is_active?: boolean };
    if (typeof is_active === 'boolean') site.is_active = is_active;

    await site.save();

    res.json({
      status: true,
      message: 'Site updated successfully',
      data: site
    });
  } catch (error) {
    console.error('Update site error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to update site'
    });
  }
};

/**
 * Delete a site from the organization.
 */
export const deleteSite = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid site id'
      });
      return;
    }

    const site = await Site.findOneAndDelete({ _id: id, organization_id: organizationId });
    if (!site) {
      res.status(404).json({
        status: false,
        message: 'Site not found'
      });
      return;
    }

    res.json({
      status: true,
      message: 'Site deleted successfully'
    });
  } catch (error) {
    console.error('Delete site error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to delete site'
    });
  }
};