import mongoose from 'mongoose';
import { Response } from 'express';
import { IngestRequest } from '../middleware/ingestAuth';
import { AdCampaign } from '../models/AdCampaign';
import { AdConnector, AD_PLATFORMS, AdPlatform } from '../models/AdConnector';
import { optionalDate, optionalEnum, optionalNumber, optionalString } from '../utils/revopsInput';
import { ensureRevopsDefaults } from '../services/revopsDefaults';
import { logger } from '../config/logger';

const MAX_EVENTS = 500;

export interface AdSpendEvent {
  platform: AdPlatform;
  campaign_id: string;
  adset_id: string;
  creative_id: string;
  name: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  currency: string;
}

/** Validate one pushed spend event; returns the normalized event or a list of issues */
export const parseAdSpendEvent = (raw: unknown): { event?: AdSpendEvent; issues: string[] } => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { issues: ['must be an object'] };
  const input = raw as Record<string, unknown>;

  const platform = optionalEnum(input.platform, AD_PLATFORMS);
  const campaignId = optionalString(input.campaign_id, 200);
  const adsetId = optionalString(input.adset_id, 200);
  const creativeId = optionalString(input.creative_id, 200);
  const name = optionalString(input.name, 300);
  const date = optionalDate(input.date);
  const spend = optionalNumber(input.spend, 0, 100_000_000);
  const impressions = optionalNumber(input.impressions, 0, 1_000_000_000);
  const clicks = optionalNumber(input.clicks, 0, 1_000_000_000);
  const currency = optionalString(input.currency, 3);

  const issues = [
    !platform && `platform must be one of ${AD_PLATFORMS.join(', ')}`,
    (campaignId === null || adsetId === null || creativeId === null) && 'campaign_id/adset_id/creative_id must be strings up to 200 chars',
    !name && 'name is required (max 300 chars)',
    !date && 'date is required as YYYY-MM-DD',
    spend === null && 'spend must be between 0 and 100,000,000',
    impressions === null && 'impressions must be a non-negative number',
    clicks === null && 'clicks must be a non-negative number',
    (currency === null || (currency && currency.length !== 3)) && 'currency must be a 3-letter code'
  ].filter((issue): issue is string => Boolean(issue));

  if (issues.length) return { issues };

  return {
    issues: [],
    event: {
      platform: platform!,
      campaign_id: campaignId ?? '',
      adset_id: adsetId ?? '',
      creative_id: creativeId ?? '',
      name: name!,
      date: date!,
      spend: spend ?? 0,
      impressions: Math.floor(impressions ?? 0),
      clicks: Math.floor(clicks ?? 0),
      currency: (currency ?? 'USD').toUpperCase()
    }
  };
};

/**
 * POST /public/ingest/ad-events
 * Headers: x-ingest-secret: <organization sk_live_ key>
 * Body: { events: [{ platform, campaign_id?, adset_id?, creative_id?, name, date, spend, impressions, clicks, currency? }] }
 *
 * Upserts on (org, platform, campaign, ad set, creative, date): re-sending a batch
 * overwrites rows instead of duplicating spend.
 */
export const ingestAdEvents = async (req: IngestRequest, res: Response): Promise<void> => {
  try {
    const organization = req.organization;
    if (!organization) {
      res.status(401).json({ status: false, message: 'Invalid credentials' });
      return;
    }
    const organizationId = organization._id as mongoose.Types.ObjectId;

    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) {
      res.status(400).json({
        status: false,
        message: 'Invalid payload',
        issues: [{ path: 'events', message: `events must be an array of 1-${MAX_EVENTS} items` }]
      });
      return;
    }

    const parsed: AdSpendEvent[] = [];
    const issues: Array<{ path: string; message: string }> = [];
    events.forEach((raw, index) => {
      const result = parseAdSpendEvent(raw);
      if (result.event) parsed.push(result.event);
      result.issues.forEach((message) => issues.push({ path: `events[${index}]`, message }));
    });
    if (issues.length) {
      res.status(400).json({ status: false, message: 'Invalid payload', issues: issues.slice(0, 50) });
      return;
    }

    await ensureRevopsDefaults(organizationId);
    const connectors = await AdConnector.find({ organization_id: organizationId }).select('_id platform').lean();
    const connectorByPlatform = new Map(connectors.map((connector) => [connector.platform, connector._id]));

    // The last occurrence of a key in one batch wins, matching re-send semantics
    const now = new Date();
    await AdCampaign.bulkWrite(
      parsed.map((event) => ({
        updateOne: {
          filter: {
            organization_id: organizationId,
            platform: event.platform,
            external_campaign_id: event.campaign_id,
            adset_id: event.adset_id,
            creative_id: event.creative_id,
            stat_date: event.date
          },
          update: {
            $set: {
              connector_id: connectorByPlatform.get(event.platform),
              name: event.name,
              spend: event.spend,
              impressions: event.impressions,
              clicks: event.clicks,
              currency: event.currency,
              synced_at: now
            }
          },
          upsert: true
        }
      })),
      { ordered: true }
    );

    const platforms = [...new Set(parsed.map((event) => event.platform))];
    const spend = Math.round(parsed.reduce((sum, event) => sum + event.spend, 0) * 100) / 100;

    // Google Ads status is owned by its OAuth connection; other push sources become "connected"
    await AdConnector.updateMany(
      { organization_id: organizationId, platform: { $in: platforms.filter((platform) => platform !== 'google_ads') } },
      { $set: { status: 'connected', last_synced_at: now } }
    );

    res.json({ status: true, data: { ingested: parsed.length, spend, platforms } });
  } catch (error) {
    logger.error({ err: error }, 'Ad event ingestion failed');
    res.status(500).json({ status: false, message: 'Ingestion failed' });
  }
};
