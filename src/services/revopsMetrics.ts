import mongoose from 'mongoose';
import { AdCampaign } from '../models/AdCampaign';
import { Deal } from '../models/Deal';
import { Contact } from '../models/Contact';

/**
 * Aggregations behind the CRO dashboard. Everything runs as
 * MongoDB pipelines scoped to one organization; nothing loads raw rows into the app.
 */

export interface DateRange {
  from?: string;
  to?: string;
}

const statDateMatch = (range: DateRange) =>
  range.from || range.to
    ? { stat_date: { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lte: range.to } : {}) } }
    : {};

const timestampMatch = (field: string, range: DateRange) =>
  range.from || range.to
    ? {
        [field]: {
          ...(range.from ? { $gte: new Date(`${range.from}T00:00:00.000Z`) } : {}),
          ...(range.to ? { $lte: new Date(`${range.to}T23:59:59.999Z`) } : {})
        }
      }
    : {};

const safeDivide = (numerator: number, denominator: number): number => (denominator ? numerator / denominator : 0);
const round = (value: number, places = 2): number => Math.round(value * 10 ** places) / 10 ** places;

export interface SpendTotals {
  spend: number;
  impressions: number;
  clicks: number;
}

export const spendByPlatform = async (organizationId: mongoose.Types.ObjectId, range: DateRange) =>
  AdCampaign.aggregate<SpendTotals & { _id: string; campaigns: string[] }>([
    { $match: { organization_id: organizationId, ...statDateMatch(range) } },
    {
      $group: {
        _id: '$platform',
        spend: { $sum: '$spend' },
        impressions: { $sum: '$impressions' },
        clicks: { $sum: '$clicks' },
        campaigns: { $addToSet: '$external_campaign_id' }
      }
    }
  ]);

export interface DealTotals {
  revenue: number;
  pipeline: number;
  won: number;
  lost: number;
  cycle_days: number;
}

/** Won revenue, open pipeline, win/loss counts and average days from creation to close */
export const dealTotals = async (organizationId: mongoose.Types.ObjectId, range: DateRange): Promise<DealTotals> => {
  const closedRange = timestampMatch('stage_changed_at', range);
  const [result] = await Deal.aggregate([
    { $match: { organization_id: organizationId } },
    {
      $facet: {
        open: [{ $match: { status: 'open' } }, { $group: { _id: null, value: { $sum: { $ifNull: ['$value', 0] } } } }],
        closed: [
          { $match: { status: { $in: ['won', 'lost'] }, ...closedRange } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              value: { $sum: { $ifNull: ['$value', 0] } },
              cycle: {
                $avg: {
                  $cond: [
                    { $gt: ['$stage_changed_at', '$created_at'] },
                    { $divide: [{ $subtract: ['$stage_changed_at', '$created_at'] }, 86_400_000] },
                    null
                  ]
                }
              }
            }
          }
        ]
      }
    }
  ]);

  const won = result?.closed?.find((row: { _id: string }) => row._id === 'won');
  const lost = result?.closed?.find((row: { _id: string }) => row._id === 'lost');

  return {
    revenue: won?.value ?? 0,
    pipeline: result?.open?.[0]?.value ?? 0,
    won: won?.count ?? 0,
    lost: lost?.count ?? 0,
    cycle_days: won?.cycle ?? 0
  };
};

/** Leads captured and routed by the Revenue Engine in the range */
export const countLeads = (organizationId: mongoose.Types.ObjectId, range: DateRange): Promise<number> =>
  Contact.countDocuments({
    organization_id: organizationId,
    'routing.routed_at': { $exists: true },
    ...timestampMatch('routing.routed_at', range)
  });

/** Won revenue closed in the range, credited to the platform its contact was routed from */
export const wonRevenueByPlatform = (
  organizationId: mongoose.Types.ObjectId,
  range: DateRange
): Promise<{ _id: string | null; revenue: number }[]> =>
  Deal.aggregate([
    { $match: { organization_id: organizationId, status: 'won', ...timestampMatch('stage_changed_at', range) } },
    {
      $lookup: {
        from: Contact.collection.name,
        localField: 'contact_id',
        foreignField: '_id',
        as: 'contact'
      }
    },
    {
      $group: {
        _id: { $arrayElemAt: ['$contact.routing.platform', 0] },
        revenue: { $sum: { $ifNull: ['$value', 0] } }
      }
    }
  ]);

/** Everything on the CRO dashboard tab */
export const buildOverview = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const [platformSpend, deals, leads, platformRevenue] = await Promise.all([
    spendByPlatform(organizationId, range),
    dealTotals(organizationId, range),
    countLeads(organizationId, range),
    wonRevenueByPlatform(organizationId, range)
  ]);

  const spend = platformSpend.reduce((sum, row) => sum + row.spend, 0);
  const clicks = platformSpend.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = platformSpend.reduce((sum, row) => sum + row.impressions, 0);

  const revenueByPlatform = new Map<string, number>();
  for (const row of platformRevenue) {
    if (row._id) revenueByPlatform.set(row._id, row.revenue);
  }

  const platforms = new Set([...platformSpend.map((row) => row._id), ...revenueByPlatform.keys()]);
  const byPlatform = [...platforms]
    .map((platform) => ({
      platform,
      spend: round(platformSpend.find((row) => row._id === platform)?.spend ?? 0),
      revenue: round(revenueByPlatform.get(platform) ?? 0)
    }))
    .filter((row) => row.spend > 0 || row.revenue > 0)
    .sort((a, b) => b.spend - a.spend);

  const closed = deals.won + deals.lost;

  return {
    spend: round(spend),
    clicks,
    impressions,
    revenue: round(deals.revenue),
    pipeline: round(deals.pipeline),
    customers: deals.won,
    leads,
    roas: round(safeDivide(deals.revenue, spend)),
    cac: round(safeDivide(spend, deals.won)),
    win_rate: round(safeDivide(deals.won, closed) * 100, 1),
    cycle_days: round(deals.cycle_days, 1),
    cpc: round(safeDivide(spend, clicks)),
    cost_per_lead: round(safeDivide(spend, leads)),
    by_platform: byPlatform
  };
};
