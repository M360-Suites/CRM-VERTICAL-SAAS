import mongoose from 'mongoose';
import { AdConnector, AdPlatform } from '../models/AdConnector';
import { RevenueTarget } from '../models/RevenueTarget';
import { NurtureTemplate } from '../models/NurtureTemplate';
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

const DEFAULT_TEMPLATES = [
  {
    name: 'Ad-click first touch',
    channel: 'email',
    tone: 'Consultative',
    stage: 'first_touch',
    subject: 'Quick note on {{pain_point}}',
    body: 'Hi {{first_name}},\n\nI noticed you came through our {{campaign_name}} campaign. Teams in {{industry}} usually reach out to us about {{pain_point}}.\n\nWorth a 15-minute call this week?\n\n{{rep_name}}',
    is_fallback: false
  },
  {
    name: 'High-intent demo push',
    channel: 'email',
    tone: 'Direct',
    stage: 'qualification',
    subject: '{{company}} + a 15-min walkthrough',
    body: 'Hi {{first_name}},\n\nBased on what you looked at, a short walkthrough would answer most of it faster than email. I have slots {{slot_1}} or {{slot_2}}.\n\n{{rep_name}}',
    is_fallback: false
  },
  {
    name: 'WhatsApp instant reply',
    channel: 'whatsapp',
    tone: 'Friendly',
    stage: 'first_touch',
    body: 'Hi {{first_name}}, {{rep_name}} here from {{our_company}} — saw your enquiry about {{pain_point}}. Happy to send a quick summary. What works better, a call or a short doc?',
    is_fallback: false
  },
  {
    name: 'SMS speed-to-lead',
    channel: 'sms',
    tone: 'Brief',
    stage: 'first_touch',
    body: 'Hi {{first_name}}, {{rep_name}} from {{our_company}}. Got your request — can I call you in the next 10 minutes?',
    is_fallback: false
  },
  {
    name: 'Generic safe fallback',
    channel: 'email',
    tone: 'Neutral',
    stage: 'fallback',
    subject: 'Following up on your enquiry',
    body: 'Hi {{first_name}},\n\nThanks for reaching out to {{our_company}}. I would like to understand what you are trying to solve so I can point you to the right thing.\n\nDo you have 15 minutes this week?\n\n{{rep_name}}',
    is_fallback: true
  },
  {
    name: 'WhatsApp fallback',
    channel: 'whatsapp',
    tone: 'Neutral',
    stage: 'fallback',
    body: 'Hi {{first_name}}, thanks for contacting {{our_company}}. When is a good time for a short call?',
    is_fallback: true
  }
] as const;

const seededOrganizations = new Set<string>();

/**
 * Give an organization its connectors, KPI targets and starter templates the first
 * time it touches the Revenue Engine. Idempotent; templates are seeded only on the
 * very first run so deleted templates don't come back.
 */
export const ensureRevopsDefaults = async (organizationId: mongoose.Types.ObjectId): Promise<void> => {
  const key = organizationId.toString();
  if (seededOrganizations.has(key)) return;

  try {
    const connectorResult = await AdConnector.bulkWrite(
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

    // Connectors were just created for this org (Google Ads may pre-exist from OAuth)
    const firstRun = connectorResult.upsertedCount > 0;
    if (firstRun && (await NurtureTemplate.countDocuments({ organization_id: organizationId })) === 0) {
      await NurtureTemplate.insertMany(
        DEFAULT_TEMPLATES.map((template) => ({ organization_id: organizationId, is_approved: true, ...template }))
      );
    }

    seededOrganizations.add(key);
  } catch (error) {
    logger.warn({ err: error, organizationId: key }, 'Failed to seed Revenue Engine defaults');
  }
};
