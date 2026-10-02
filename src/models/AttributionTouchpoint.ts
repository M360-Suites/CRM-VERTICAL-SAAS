/**
 * AttributionTouchpoint model
 * One step of a buyer journey, stitched to a contact/deal and the campaign that started it
 */
import mongoose, { Document, Schema } from 'mongoose';
import { AD_PLATFORMS, AdPlatform } from './AdConnector';

export const TOUCHPOINT_TYPES = [
  'impression',
  'click',
  'pixel_event',
  'contact_created',
  'deal_created',
  'deal_won',
  'deal_lost',
  'message_sent',
  'message_reply'
] as const;
export type TouchpointType = (typeof TOUCHPOINT_TYPES)[number];

export interface IAttributionTouchpoint extends Document {
  organization_id: mongoose.Types.ObjectId;
  contact_id?: mongoose.Types.ObjectId;
  deal_id?: mongoose.Types.ObjectId;
  platform?: AdPlatform;
  /** Platform campaign ID — joins to ad_campaigns.external_campaign_id */
  external_campaign_id?: string;
  type: TouchpointType;
  value?: number;
  occurred_at: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
}

const AttributionTouchpointSchema = new Schema<IAttributionTouchpoint>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact' },
    deal_id: { type: Schema.Types.ObjectId, ref: 'Deal' },
    platform: { type: String, enum: AD_PLATFORMS },
    external_campaign_id: { type: String },
    type: { type: String, enum: TOUCHPOINT_TYPES, required: true },
    value: { type: Number },
    occurred_at: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false }
  }
);

AttributionTouchpointSchema.index({ organization_id: 1, occurred_at: -1 });
AttributionTouchpointSchema.index({ organization_id: 1, platform: 1, external_campaign_id: 1 });
AttributionTouchpointSchema.index({ organization_id: 1, contact_id: 1 });

export const AttributionTouchpoint = mongoose.model<IAttributionTouchpoint>(
  'AttributionTouchpoint',
  AttributionTouchpointSchema,
  'attribution_touchpoints'
);
