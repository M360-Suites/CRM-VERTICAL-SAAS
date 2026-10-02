/**
 * AdCampaign model
 * One row per (campaign, adset, creative, day) of ad spend. The unique index is the
 * idempotency key: re-syncing the same day overwrites the row, never duplicates it.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { AD_PLATFORMS, AdPlatform } from './AdConnector';

export interface IAdCampaign extends Document {
  organization_id: mongoose.Types.ObjectId;
  connector_id?: mongoose.Types.ObjectId;
  platform: AdPlatform;
  external_campaign_id: string;
  name?: string;
  channel_type?: string;
  /** '' when the platform row is campaign-level */
  adset_id: string;
  /** '' when the platform row is campaign- or adset-level */
  creative_id: string;
  /** YYYY-MM-DD in the ad account's timezone */
  stat_date: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  currency: string;
  synced_at: Date;
  created_at: Date;
  updated_at: Date;
}

const AdCampaignSchema = new Schema<IAdCampaign>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    connector_id: { type: Schema.Types.ObjectId, ref: 'AdConnector' },
    platform: { type: String, enum: AD_PLATFORMS, required: true },
    external_campaign_id: { type: String, required: true },
    name: { type: String },
    channel_type: { type: String },
    adset_id: { type: String, default: '' },
    creative_id: { type: String, default: '' },
    stat_date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    synced_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

AdCampaignSchema.index(
  { organization_id: 1, platform: 1, external_campaign_id: 1, adset_id: 1, creative_id: 1, stat_date: 1 },
  { unique: true }
);
AdCampaignSchema.index({ organization_id: 1, stat_date: 1 });

export const AdCampaign = mongoose.model<IAdCampaign>('AdCampaign', AdCampaignSchema, 'ad_campaigns');
