import mongoose from 'mongoose';
import { AdConnector, IAdConnector } from '../models/AdConnector';
import { AdCampaign } from '../models/AdCampaign';
import { decryptString } from '../utils/crypto';
import {
  GoogleAdsApiError,
  GoogleAdsDailySpendRow,
  fetchDailyCampaignSpend,
  getAccessToken,
  isGoogleAdsConfigured
} from '../utils/googleAds';
import { recordWarehouseEvent } from '../utils/warehouse';
import { logger } from '../config/logger';

const DEFAULT_INTERVAL_MINUTES = 360;
/** Google keeps adjusting cost (invalid-click credits, late conversions) for several days */
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_BACKFILL_DAYS = 30;
const SYNC_LOCK_MS = 10 * 60 * 1000;

let syncTimer: NodeJS.Timeout | undefined;
let isRunning = false;

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Inclusive date window ending today. One extra day on each side covers the gap
 * between UTC and the ad account's timezone.
 */
export const getSyncWindow = (days: number, now = new Date()): { from: string; to: string } => {
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: formatDate(from), to: formatDate(to) };
};

/**
 * Build idempotent upserts. The filter is exactly the unique index on ad_campaigns,
 * so re-syncing a day overwrites its row instead of adding another.
 */
export const buildSpendUpserts = (
  organizationId: mongoose.Types.ObjectId,
  connectorId: mongoose.Types.ObjectId,
  rows: GoogleAdsDailySpendRow[],
  syncedAt = new Date()
) =>
  rows.map((row) => ({
    updateOne: {
      filter: {
        organization_id: organizationId,
        platform: 'google_ads',
        external_campaign_id: row.external_campaign_id,
        adset_id: '',
        creative_id: '',
        stat_date: row.stat_date
      },
      update: {
        $set: {
          connector_id: connectorId,
          name: row.name,
          channel_type: row.channel_type,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          currency: row.currency,
          synced_at: syncedAt
        }
      },
      upsert: true
    }
  }));

/** Claim the connector for this sync; returns null if another sync holds the lease */
const acquireSyncLock = async (connectorId: mongoose.Types.ObjectId): Promise<IAdConnector | null> => {
  const now = new Date();
  return AdConnector.findOneAndUpdate(
    {
      _id: connectorId,
      status: { $in: ['connected', 'error'] },
      $or: [{ sync_lock_until: { $exists: false } }, { sync_lock_until: null }, { sync_lock_until: { $lt: now } }]
    },
    { $set: { sync_lock_until: new Date(now.getTime() + SYNC_LOCK_MS) } },
    { new: true }
  ).select('+refresh_token');
};

export interface SyncResult {
  rows: number;
  spend: number;
  from: string;
  to: string;
}

/**
 * Pull daily campaign spend for one Google Ads connector and upsert it.
 * Throws if the connector is busy, not connected, or Google rejects the request.
 */
export const syncGoogleAdsConnector = async (
  connectorId: mongoose.Types.ObjectId,
  options: { days?: number; actorId?: string } = {}
): Promise<SyncResult> => {
  const connector = await acquireSyncLock(connectorId);
  if (!connector) {
    throw new Error('Connector is not connected or a sync is already running');
  }

  const days = options.days ?? (connector.last_synced_at
    ? toPositiveNumber(process.env.GOOGLE_ADS_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS)
    : toPositiveNumber(process.env.GOOGLE_ADS_BACKFILL_DAYS, DEFAULT_BACKFILL_DAYS));
  const { from, to } = getSyncWindow(days);

  try {
    const refreshToken = decryptString(connector.refresh_token);
    if (!refreshToken || !connector.external_account_id) {
      throw new GoogleAdsApiError('Connector is missing credentials or an ad account', 400, !refreshToken);
    }

    const accessToken = await getAccessToken(refreshToken);
    const rows = await fetchDailyCampaignSpend(
      accessToken,
      connector.external_account_id,
      from,
      to,
      connector.login_customer_id
    );

    if (rows.length > 0) {
      await AdCampaign.bulkWrite(buildSpendUpserts(connector.organization_id, connector._id as mongoose.Types.ObjectId, rows), {
        ordered: false
      });
    }

    const spend = Math.round(rows.reduce((sum, row) => sum + row.spend, 0) * 100) / 100;

    await AdConnector.updateOne(
      { _id: connector._id },
      {
        $set: { status: 'connected', last_synced_at: new Date() },
        $unset: { last_sync_error: 1, sync_lock_until: 1 }
      }
    );

    await recordWarehouseEvent({
      organizationId: connector.organization_id,
      source: 'google_ads_sync',
      eventType: 'ad_spend_ingested',
      entityType: 'ad_connector',
      entityId: connector._id as mongoose.Types.ObjectId,
      actorId: options.actorId,
      payload: { platform: 'google_ads', rows: rows.length, spend, from, to }
    });

    return { rows: rows.length, spend, from, to };
  } catch (error) {
    const reauthRequired = error instanceof GoogleAdsApiError && error.reauthRequired;
    await AdConnector.updateOne(
      { _id: connector._id },
      {
        $set: {
          status: 'error',
          last_sync_error: reauthRequired ? 'reauth_required' : (error as Error).message.slice(0, 500)
        },
        $unset: { sync_lock_until: 1 }
      }
    );
    throw error;
  }
};

/** Sync every connected Google Ads connector across all organizations */
export const syncAllGoogleAdsConnectors = async (): Promise<void> => {
  if (isRunning) return;
  isRunning = true;

  try {
    const connectors = await AdConnector.find({ platform: 'google_ads', status: 'connected' })
      .select('_id organization_id')
      .lean();

    for (const connector of connectors) {
      try {
        const result = await syncGoogleAdsConnector(connector._id as mongoose.Types.ObjectId);
        logger.info({ connectorId: connector._id, ...result }, 'Google Ads spend synced');
      } catch (error) {
        logger.warn({ err: error, connectorId: connector._id }, 'Google Ads sync failed');
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to run Google Ads sync');
  } finally {
    isRunning = false;
  }
};

export const startGoogleAdsSyncService = (): void => {
  if (process.env.GOOGLE_ADS_SYNC_ENABLED === 'false') {
    logger.info('Google Ads sync service disabled');
    return;
  }

  if (!isGoogleAdsConfigured()) {
    logger.info('Google Ads sync service not started — Google OAuth client / redirect URI not configured');
    return;
  }

  if (syncTimer) return;

  const intervalMinutes = toPositiveNumber(process.env.GOOGLE_ADS_SYNC_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES);

  void syncAllGoogleAdsConnectors();
  syncTimer = setInterval(() => {
    void syncAllGoogleAdsConnectors();
  }, intervalMinutes * 60 * 1000);

  logger.info(`Google Ads sync service started; syncing every ${intervalMinutes} minutes`);
};
