import { Response } from 'express';
import { AuthRequest } from '../types';
import { AdCampaign } from '../models/AdCampaign';
import { AD_PLATFORMS, AdConnector } from '../models/AdConnector';
import { RevenueTarget, REVENUE_TARGET_KEYS } from '../models/RevenueTarget';
import { requireOrganization } from '../utils/tenant';
import {
  DATE_PATTERN,
  optionalDate,
  optionalEnum,
  optionalNumber,
  optionalObjectId,
  optionalString,
  parsePaging
} from '../utils/revopsInput';
import { DateRange, buildOverview, spendByPlatform } from '../services/revopsMetrics';
import { logger } from '../config/logger';

const DEFAULT_RANGE_DAYS = 30;

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const parseRange = (req: AuthRequest, res: Response): DateRange | null => {
  const from = optionalDate(req.query.from);
  const to = optionalDate(req.query.to);
  if (from === null || to === null || (from && to && from > to)) {
    res.status(400).json({ status: false, message: 'from/to must be YYYY-MM-DD and from <= to' });
    return null;
  }
  return { from, to };
};

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

/** Divide, returning null instead of Infinity/NaN; rounded to 4 decimals */
const ratio = (numerator: unknown, denominator: unknown) => ({
  $cond: [
    { $gt: [denominator, 0] },
    { $round: [{ $divide: [numerator, denominator] }, 4] },
    null
  ]
});

const metricTotals = {
  spend: { $sum: '$spend' },
  impressions: { $sum: '$impressions' },
  clicks: { $sum: '$clicks' },
  conversions: { $sum: '$conversions' }
};

const derivedMetrics = {
  spend: { $round: ['$spend', 2] },
  impressions: 1,
  clicks: 1,
  conversions: { $round: ['$conversions', 2] },
  cpc: ratio('$spend', '$clicks'),
  ctr: ratio('$clicks', '$impressions'),
  cpm: ratio({ $multiply: ['$spend', 1000] }, '$impressions'),
  cost_per_conversion: ratio('$spend', '$conversions')
};

/**
 * GET /revops/costs?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=google_ads
 * Spend, CPC, CTR, CPM and cost per conversion by platform, campaign and day.
 * Grouped by currency as well — accounts in different currencies are never summed together.
 */
export const getCosts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const to = typeof req.query.to === 'string' ? req.query.to : formatDate(new Date());
    const from =
      typeof req.query.from === 'string'
        ? req.query.from
        : formatDate(new Date(Date.now() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000));
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;

    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
      res.status(400).json({ status: false, message: 'from/to must be YYYY-MM-DD and from <= to' });
      return;
    }
    if (platform && !(AD_PLATFORMS as readonly string[]).includes(platform)) {
      res.status(400).json({ status: false, message: 'Unknown platform' });
      return;
    }

    const [result] = await AdCampaign.aggregate([
      {
        $match: {
          organization_id: organizationId,
          stat_date: { $gte: from, $lte: to },
          ...(platform ? { platform } : {})
        }
      },
      {
        $facet: {
          by_platform: [
            { $group: { _id: { platform: '$platform', currency: '$currency' }, ...metricTotals } },
            { $project: { _id: 0, platform: '$_id.platform', currency: '$_id.currency', ...derivedMetrics } },
            { $sort: { spend: -1 } }
          ],
          by_campaign: [
            {
              $group: {
                _id: { platform: '$platform', campaign_id: '$external_campaign_id', currency: '$currency' },
                name: { $last: '$name' },
                ...metricTotals
              }
            },
            {
              $project: {
                _id: 0,
                platform: '$_id.platform',
                campaign_id: '$_id.campaign_id',
                currency: '$_id.currency',
                name: 1,
                ...derivedMetrics
              }
            },
            { $sort: { spend: -1 } },
            { $limit: 100 }
          ],
          daily: [
            { $group: { _id: { date: '$stat_date', currency: '$currency' }, ...metricTotals } },
            { $project: { _id: 0, date: '$_id.date', currency: '$_id.currency', ...derivedMetrics } },
            { $sort: { date: 1 } }
          ]
        }
      }
    ]);

    res.json({
      status: true,
      data: {
        from,
        to,
        by_platform: result?.by_platform ?? [],
        by_campaign: result?.by_campaign ?? [],
        daily: result?.daily ?? []
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to compute ad costs');
  }
};

/**
 * GET /revops/overview — CRO dashboard KPIs, spend vs revenue by platform and targets
 */
export const getOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const range = parseRange(req, res);
    if (!range) return;

    const [metrics, targets] = await Promise.all([
      buildOverview(organizationId, range),
      RevenueTarget.find({ organization_id: organizationId }).select('key label target_value unit').lean()
    ]);

    res.json({ status: true, data: { ...metrics, targets } });
  } catch (error) {
    handleError(res, error, 'Failed to load revenue overview');
  }
};

/**
 * GET /revops/connectors — one card per traffic source with campaign count and tracked spend
 */
export const listConnectors = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const [connectors, spend] = await Promise.all([
      AdConnector.find({ organization_id: organizationId }).sort({ platform: 1 }).lean(),
      spendByPlatform(organizationId, {})
    ]);

    res.json({
      status: true,
      data: connectors.map((connector) => {
        const platformSpend = spend.find((row) => row._id === connector.platform);
        return {
          id: connector._id,
          platform: connector.platform,
          display_name: connector.display_name,
          status: connector.status,
          account_name: connector.account_name ?? null,
          last_synced_at: connector.last_synced_at ?? null,
          last_sync_error: connector.last_sync_error ?? null,
          /** Google Ads connects via OAuth (/integrations/google-ads), not manual status */
          connect_via: connector.platform === 'google_ads' ? 'oauth' : 'manual',
          campaigns: platformSpend?.campaigns.length ?? 0,
          spend: Math.round((platformSpend?.spend ?? 0) * 100) / 100
        };
      })
    });
  } catch (error) {
    handleError(res, error, 'Failed to load connectors');
  }
};

/**
 * PATCH /revops/connectors/:id/status — body { status: connected | disconnected | error }
 */
export const updateConnectorStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const status = optionalEnum(req.body?.status, ['connected', 'disconnected', 'error'] as const);
    if (!status) {
      res.status(400).json({ status: false, message: 'status must be connected, disconnected or error' });
      return;
    }

    const connectorId = optionalObjectId(req.params.id);
    const connector = connectorId ? await AdConnector.findOne({ _id: connectorId, organization_id: organizationId }) : null;
    if (!connector) {
      res.status(404).json({ status: false, message: 'Connector not found' });
      return;
    }
    if (connector.platform === 'google_ads') {
      res.status(400).json({
        status: false,
        message: 'Google Ads is connected through OAuth. Use /integrations/google-ads to connect or disconnect.'
      });
      return;
    }

    connector.status = status;
    if (status === 'connected') connector.last_synced_at = new Date();
    await connector.save();

    res.json({ status: true, message: `Connector marked ${status}`, data: connector });
  } catch (error) {
    handleError(res, error, 'Failed to update connector');
  }
};

/**
 * GET /revops/campaigns — spend ledger, newest day first
 * Query: page, limit, platform, from, to
 */
export const listCampaignRows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const range = parseRange(req, res);
    if (!range) return;
    const platform = optionalEnum(req.query.platform, AD_PLATFORMS);
    if (platform === null) {
      res.status(400).json({ status: false, message: 'Unknown platform' });
      return;
    }

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 100, 500);
    const filter = {
      organization_id: organizationId,
      ...(platform ? { platform } : {}),
      ...(range.from || range.to
        ? { stat_date: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } }
        : {})
    };

    const [rows, total] = await Promise.all([
      AdCampaign.find(filter).sort({ stat_date: -1, spend: -1 }).skip(skip).limit(limit).lean(),
      AdCampaign.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: rows.map((row) => ({
        ...row,
        cpc: row.clicks ? Math.round((row.spend / row.clicks) * 100) / 100 : null
      })),
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load spend ledger');
  }
};

const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/**
 * POST /revops/campaigns — manually log a day of spend.
 * Upserts on the same key as automated syncs, so logging the same day twice overwrites.
 */
export const logCampaignSpend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const body = req.body ?? {};
    const platform = optionalEnum(body.platform, AD_PLATFORMS);
    const name = optionalString(body.name, 300);
    const statDate = optionalDate(body.stat_date ?? body.date);
    const externalId = optionalString(body.external_campaign_id ?? body.campaign_id, 200);
    const adsetId = optionalString(body.adset_id, 200);
    const creativeId = optionalString(body.creative_id, 200);
    const spend = optionalNumber(body.spend, 0, 100_000_000);
    const impressions = optionalNumber(body.impressions, 0, 1_000_000_000);
    const clicks = optionalNumber(body.clicks, 0, 1_000_000_000);
    const currency = optionalString(body.currency, 3);

    const errors = [
      !platform && 'platform is required and must be a known platform',
      !name && 'name is required (max 300 chars)',
      !statDate && 'stat_date is required as YYYY-MM-DD',
      externalId === null && 'external_campaign_id is invalid',
      (adsetId === null || creativeId === null) && 'adset_id/creative_id are invalid',
      spend === null && 'spend must be between 0 and 100,000,000',
      (impressions === null || clicks === null) && 'impressions/clicks must be non-negative numbers',
      currency === null && 'currency must be a 3-letter code'
    ].filter(Boolean);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }

    const connector = await AdConnector.findOne({ organization_id: organizationId, platform }).select('_id').lean();
    const row = await AdCampaign.findOneAndUpdate(
      {
        organization_id: organizationId,
        platform,
        external_campaign_id: externalId || `manual:${slug(name!)}`,
        adset_id: adsetId ?? '',
        creative_id: creativeId ?? '',
        stat_date: statDate
      },
      {
        $set: {
          connector_id: connector?._id,
          name,
          spend: spend ?? 0,
          impressions: Math.floor(impressions ?? 0),
          clicks: Math.floor(clicks ?? 0),
          currency: (currency ?? 'USD').toUpperCase(),
          synced_at: new Date()
        }
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ status: true, message: 'Spend recorded', data: row });
  } catch (error) {
    handleError(res, error, 'Failed to record spend');
  }
};

/**
 * DELETE /revops/campaigns/:id
 */
export const deleteCampaignRow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const rowId = optionalObjectId(req.params.id);
    const row = rowId ? await AdCampaign.findOneAndDelete({ _id: rowId, organization_id: organizationId }) : null;
    if (!row) {
      res.status(404).json({ status: false, message: 'Spend row not found' });
      return;
    }

    res.json({ status: true, message: 'Spend row deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete spend row');
  }
};

/**
 * GET /revops/targets
 */
export const listTargets = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const targets = await RevenueTarget.find({ organization_id: organizationId }).sort({ key: 1 }).lean();
    res.json({ status: true, data: targets });
  } catch (error) {
    handleError(res, error, 'Failed to load targets');
  }
};

/**
 * PUT /revops/targets/:key — body { target_value, label?, unit? }
 */
export const updateTarget = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const key = optionalEnum(req.params.key, REVENUE_TARGET_KEYS);
    const targetValue = optionalNumber(req.body?.target_value, 0, 1_000_000_000_000);
    const label = optionalString(req.body?.label, 100);
    const unit = optionalString(req.body?.unit, 10);
    if (!key) {
      res.status(404).json({ status: false, message: 'Unknown target' });
      return;
    }
    if (targetValue === undefined || targetValue === null || label === null || unit === null) {
      res.status(400).json({ status: false, message: 'target_value must be a non-negative number' });
      return;
    }

    const target = await RevenueTarget.findOneAndUpdate(
      { organization_id: organizationId, key },
      { $set: { target_value: targetValue, ...(label ? { label } : {}), ...(unit ? { unit } : {}) } },
      { new: true }
    );
    if (!target) {
      res.status(404).json({ status: false, message: 'Target not found' });
      return;
    }

    res.json({ status: true, message: 'Target updated', data: target });
  } catch (error) {
    handleError(res, error, 'Failed to update target');
  }
};
