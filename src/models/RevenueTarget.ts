/**
 * RevenueTarget model
 * Executive KPI goals shown as progress bars on the CRO dashboard
 */
import mongoose, { Document, Schema } from 'mongoose';

export const REVENUE_TARGET_KEYS = ['ad_cost', 'revenue', 'roas', 'cac', 'cycle_days'] as const;
export type RevenueTargetKey = (typeof REVENUE_TARGET_KEYS)[number];

export interface IRevenueTarget extends Document {
  organization_id: mongoose.Types.ObjectId;
  key: RevenueTargetKey;
  label: string;
  target_value: number;
  unit: string;
  created_at: Date;
  updated_at: Date;
}

const RevenueTargetSchema = new Schema<IRevenueTarget>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    key: { type: String, enum: REVENUE_TARGET_KEYS, required: true },
    label: { type: String, required: true },
    target_value: { type: Number, required: true, min: 0 },
    unit: { type: String, default: 'USD' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

RevenueTargetSchema.index({ organization_id: 1, key: 1 }, { unique: true });

export const RevenueTarget = mongoose.model<IRevenueTarget>('RevenueTarget', RevenueTargetSchema, 'revenue_targets');
