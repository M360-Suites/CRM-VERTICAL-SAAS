/**
 * RoutingRule model
 * Evaluated top-down by priority when a lead is created; first full match wins
 */
import mongoose, { Document, Schema } from 'mongoose';
import { AD_PLATFORMS, AdPlatform } from './AdConnector';

export interface IRoutingRule extends Document {
  organization_id: mongoose.Types.ObjectId;
  name: string;
  /** Lower runs first */
  priority: number;
  region?: string;
  tier?: string;
  platform?: AdPlatform;
  min_intent_score: number;
  /** Empty means least-loaded rep */
  assignee_id?: mongoose.Types.ObjectId;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const RoutingRuleSchema = new Schema<IRoutingRule>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    priority: { type: Number, default: 100 },
    region: { type: String, trim: true },
    tier: { type: String, trim: true },
    platform: { type: String, enum: AD_PLATFORMS },
    min_intent_score: { type: Number, default: 0, min: 0, max: 100 },
    assignee_id: { type: Schema.Types.ObjectId, ref: 'User' },
    is_active: { type: Boolean, default: true }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

RoutingRuleSchema.index({ organization_id: 1, is_active: 1, priority: 1 });

export const RoutingRule = mongoose.model<IRoutingRule>('RoutingRule', RoutingRuleSchema, 'routing_rules');
