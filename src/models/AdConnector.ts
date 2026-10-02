/**
 * AdConnector model
 * One ad-platform connection per organization (e.g. the org's Google Ads account)
 */
import mongoose, { Document, Schema } from 'mongoose';

export const AD_PLATFORMS = ['google_ads', 'meta', 'linkedin', 'tiktok', 'web_form', 'seo', 'other'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/**
 * - pending: OAuth granted, no ad account selected yet
 * - connected: account selected, syncing
 * - error: last sync failed (see last_sync_error); reauth_required means the token was revoked
 * - disconnected: credentials removed, historical spend kept
 */
export type AdConnectorStatus = 'pending' | 'connected' | 'error' | 'disconnected';

export interface IAdConnector extends Document {
  organization_id: mongoose.Types.ObjectId;
  platform: AdPlatform;
  display_name: string;
  status: AdConnectorStatus;
  external_account_id?: string;
  account_name?: string;
  currency?: string;
  login_customer_id?: string;
  refresh_token?: string;
  connected_by?: mongoose.Types.ObjectId;
  last_synced_at?: Date;
  last_sync_error?: string;
  sync_lock_until?: Date;
  created_at: Date;
  updated_at: Date;
}

const AdConnectorSchema = new Schema<IAdConnector>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    platform: { type: String, enum: AD_PLATFORMS, required: true },
    display_name: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'connected', 'error', 'disconnected'],
      default: 'pending'
    },
    external_account_id: { type: String },
    account_name: { type: String },
    currency: { type: String },
    login_customer_id: { type: String },
    /** Encrypted with utils/crypto; never selected by default */
    refresh_token: { type: String, select: false },
    connected_by: { type: Schema.Types.ObjectId, ref: 'User' },
    last_synced_at: { type: Date },
    last_sync_error: { type: String },
    sync_lock_until: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

AdConnectorSchema.index({ organization_id: 1, platform: 1 }, { unique: true });
AdConnectorSchema.index({ platform: 1, status: 1 });

export const AdConnector = mongoose.model<IAdConnector>('AdConnector', AdConnectorSchema, 'ad_connectors');
