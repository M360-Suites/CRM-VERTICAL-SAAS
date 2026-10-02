import mongoose from 'mongoose';
import { AdCampaign } from '../models/AdCampaign';
import { Deal } from '../models/Deal';
import { AttributionTouchpoint } from '../models/AttributionTouchpoint';

/**
 * Aggregations behind the CRO dashboard and Attribution tab. Everything runs as
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

export interface AttributedRow {
  platform: string | null;
  campaign_id: string;
  leads: number;
  deals: number;
  won_deals: number;
  revenue: number;
}

/**
 * First-touch attribution: each contact is credited to the platform/campaign of
 * its earliest contact_created touchpoint, and that contact's won deals are its
 * revenue. Manually recorded deal_won touchpoint values are honored when larger.
 */
export const attributedByCampaign = async (
  organizationId: mongoose.Types.ObjectId,
  range: DateRange
): Promise<AttributedRow[]> => {
  const [fromContacts, directWon] = await Promise.all([
    AttributionTouchpoint.aggregate<AttributedRow & { _id: { platform: string | null; campaign_id: string } }>([
      {
        $match: {
          organization_id: organizationId,
          type: 'contact_created',
          contact_id: { $exists: true },
          ...timestampMatch('occurred_at', range)
        }
      },
      { $sort: { occurred_at: 1 } },
      {
        $group: {
          _id: '$contact_id',
          platform: { $first: '$platform' },
          campaign_id: { $first: { $ifNull: ['$external_campaign_id', ''] } }
        }
      },
      {
        $lookup: {
          from: Deal.collection.name,
          let: { contactId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$contact_id', '$$contactId'] }, { $eq: ['$organization_id', organizationId] }] }
              }
            },
            { $project: { status: 1, value: 1 } }
          ],
          as: 'deals'
        }
      },
      {
        $project: {
          platform: 1,
          campaign_id: 1,
          deal_count: { $size: '$deals' },
          won: { $filter: { input: '$deals', cond: { $eq: ['$$this.status', 'won'] } } }
        }
      },
      {
        $group: {
          _id: { platform: '$platform', campaign_id: '$campaign_id' },
          leads: { $sum: 1 },
          deals: { $sum: '$deal_count' },
          won_deals: { $sum: { $size: '$won' } },
          revenue: { $sum: { $sum: { $map: { input: '$won', in: { $ifNull: ['$$this.value', 0] } } } } }
        }
      }
    ]),
    AttributionTouchpoint.aggregate<{ _id: { platform: string | null; campaign_id: string }; revenue: number }>([
      { $match: { organization_id: organizationId, type: 'deal_won', ...timestampMatch('occurred_at', range) } },
      {
        $group: {
          _id: { platform: '$platform', campaign_id: { $ifNull: ['$external_campaign_id', ''] } },
          revenue: { $sum: { $ifNull: ['$value', 0] } }
        }
      }
    ])
  ]);

  const rows = new Map<string, AttributedRow>();
  const keyOf = (id: { platform: string | null; campaign_id: string }) => `${id.platform ?? ''}|${id.campaign_id}`;

  for (const row of fromContacts) {
    rows.set(keyOf(row._id), {
      platform: row._id.platform ?? null,
      campaign_id: row._id.campaign_id,
      leads: row.leads,
      deals: row.deals,
      won_deals: row.won_deals,
      revenue: row.revenue
    });
  }
  for (const row of directWon) {
    const existing = rows.get(keyOf(row._id));
    if (existing) {
      existing.revenue = Math.max(existing.revenue, row.revenue);
    } else {
      rows.set(keyOf(row._id), {
        platform: row._id.platform ?? null,
        campaign_id: row._id.campaign_id,
        leads: 0,
        deals: 0,
        won_deals: 0,
        revenue: row.revenue
      });
    }
  }

  return [...rows.values()];
};

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

export const countLeads = (organizationId: mongoose.Types.ObjectId, range: DateRange): Promise<number> =>
  AttributionTouchpoint.countDocuments({
    organization_id: organizationId,
    type: 'contact_created',
    ...timestampMatch('occurred_at', range)
  });

/** Everything on the CRO dashboard tab */
export const buildOverview = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const [platformSpend, deals, leads, attributed] = await Promise.all([
    spendByPlatform(organizationId, range),
    dealTotals(organizationId, range),
    countLeads(organizationId, range),
    attributedByCampaign(organizationId, range)
  ]);

  const spend = platformSpend.reduce((sum, row) => sum + row.spend, 0);
  const clicks = platformSpend.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = platformSpend.reduce((sum, row) => sum + row.impressions, 0);

  const revenueByPlatform = new Map<string, number>();
  for (const row of attributed) {
    if (!row.platform) continue;
    revenueByPlatform.set(row.platform, (revenueByPlatform.get(row.platform) ?? 0) + row.revenue);
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

/** Everything on the Attribution & ROI tab */
export const buildAttribution = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const [attributed, campaignSpend, touchpointCounts] = await Promise.all([
    attributedByCampaign(organizationId, range),
    AdCampaign.aggregate<{ _id: { platform: string; campaign_id: string }; name: string; spend: number; clicks: number; impressions: number }>([
      { $match: { organization_id: organizationId, ...statDateMatch(range) } },
      { $sort: { stat_date: 1 } },
      {
        $group: {
          _id: { platform: '$platform', campaign_id: '$external_campaign_id' },
          name: { $last: '$name' },
          spend: { $sum: '$spend' },
          clicks: { $sum: '$clicks' },
          impressions: { $sum: '$impressions' }
        }
      }
    ]),
    AttributionTouchpoint.aggregate<{ _id: string; count: number }>([
      { $match: { organization_id: organizationId, ...timestampMatch('occurred_at', range) } },
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ])
  ]);

  const key = (platform: string | null, campaignId: string) => `${platform ?? ''}|${campaignId}`;
  const attributedByKey = new Map(attributed.map((row) => [key(row.platform, row.campaign_id), row]));

  const campaigns = campaignSpend.map((row) => {
    const match = attributedByKey.get(key(row._id.platform, row._id.campaign_id));
    attributedByKey.delete(key(row._id.platform, row._id.campaign_id));
    const revenue = match?.revenue ?? 0;
    return {
      platform: row._id.platform,
      campaign_id: row._id.campaign_id,
      name: row.name || row._id.campaign_id,
      spend: round(row.spend),
      clicks: row.clicks,
      leads: match?.leads ?? 0,
      deals: match?.deals ?? 0,
      won_deals: match?.won_deals ?? 0,
      revenue: round(revenue),
      roi: row.spend ? round(((revenue - row.spend) / row.spend) * 100, 1) : null
    };
  });

  // Leads that came in without a tracked campaign (organic, web form, unknown campaign)
  for (const row of attributedByKey.values()) {
    campaigns.push({
      platform: row.platform ?? 'other',
      campaign_id: row.campaign_id,
      name: row.campaign_id || 'Untracked',
      spend: 0,
      clicks: 0,
      leads: row.leads,
      deals: row.deals,
      won_deals: row.won_deals,
      revenue: round(row.revenue),
      roi: null
    });
  }

  campaigns.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);

  const touchpoints = Object.fromEntries(touchpointCounts.map((row) => [row._id, row.count]));
  const adImpressions = campaignSpend.reduce((sum, row) => sum + row.impressions, 0);
  const adClicks = campaignSpend.reduce((sum, row) => sum + row.clicks, 0);

  return {
    funnel: [
      { stage: 'impression', value: Math.max(adImpressions, touchpoints.impression ?? 0) },
      { stage: 'click', value: Math.max(adClicks, touchpoints.click ?? 0) },
      { stage: 'contact_created', value: touchpoints.contact_created ?? 0 },
      { stage: 'deal_created', value: touchpoints.deal_created ?? 0 },
      { stage: 'deal_won', value: attributed.reduce((sum, row) => sum + row.won_deals, 0) }
    ],
    campaigns
  };
};
