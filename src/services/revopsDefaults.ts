import mongoose from 'mongoose';
import { AdConnector, AdPlatform } from '../models/AdConnector';
import { RevenueTarget } from '../models/RevenueTarget';
import { logger } from '../config/logger';

const DEFAULT_CONNECTORS: Array<{ platform: AdPlatform; display_name: string; status: 'pending' | 'connected' }> = [
  { platform: 'google_ads', display_name: 'Google Ads', status: 'pending' },
  { platform: 'meta', display_name: 'Meta Graph', status: 'pending' },
  { platform: 'linkedin', display_name: 'LinkedIn Marketing', status: 'pending' },
  { platform: 'tiktok', display_name: 'TikTok Ads', status: 'pending' },
  { platform: 'web_form', display_name: 'Website Web Form', status: 'connected' },
  { platform: 'seo', display_name: 'SEO / Organic Search', status: 'connected' }
];

const DEFAULT_TARGETS = [
  { key: 'ad_cost', label: 'Ad cost ceiling', target_value: 50000, unit: 'USD' },
  { key: 'revenue', label: 'Revenue target', target_value: 500000, unit: 'USD' },
  { key: 'roas', label: 'Return on ad spend', target_value: 4, unit: 'x' },
  { key: 'cac', label: 'CAC threshold', target_value: 1500, unit: 'USD' },
  { key: 'cycle_days', label: 'Pipeline velocity target', target_value: 45, unit: 'days' }
] as const;

const seededOrganizations = new Set<string>();

/**
 * Give an organization its connectors and KPI targets the first time it touches
 * the Revenue Engine. Idempotent.
 */
export const ensureRevopsDefaults = async (organizationId: mongoose.Types.ObjectId): Promise<void> => {
  const key = organizationId.toString();
  if (seededOrganizations.has(key)) return;

  try {
    await AdConnector.bulkWrite(
      DEFAULT_CONNECTORS.map((connector) => ({
        updateOne: {
          filter: { organization_id: organizationId, platform: connector.platform },
          update: { $setOnInsert: { organization_id: organizationId, ...connector } },
          upsert: true
        }
      })),
      { ordered: false }
    );

    await RevenueTarget.bulkWrite(
      DEFAULT_TARGETS.map((target) => ({
        updateOne: {
          filter: { organization_id: organizationId, key: target.key },
          update: { $setOnInsert: { organization_id: organizationId, ...target } },
          upsert: true
        }
      })),
      { ordered: false }
    );

    seededOrganizations.add(key);
  } catch (error) {
    logger.warn({ err: error, organizationId: key }, 'Failed to seed Revenue Engine defaults');
  }
};
