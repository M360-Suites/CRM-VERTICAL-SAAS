/**
 * Deal model for CRM deals/opportunities
 * Represents sales deals with value and stage
 */
import mongoose, { Document, Schema } from 'mongoose';

export type DealStatus = 'open' | 'won' | 'lost';

/**
 * Deal document interface
 * Extends Mongoose Document with typed fields
 */
export interface IDeal extends Document {
  title: string;
  value?: number;
  currency?: string;
  status: DealStatus;
  expected_close_date?: Date;
  stage_id?: mongoose.Types.ObjectId;
  source?: string;
  industry?: string;
  description?: string;
  company_id?: mongoose.Types.ObjectId;
  contact_id?: mongoose.Types.ObjectId;
  owner_id?: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  stage_changed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Deal schema definition
 * Defines fields, validation, and timestamps
 */
const DealSchema = new Schema<IDeal>(
  {
    title: { type: String, required: true },
    value: { type: Number },
    currency: { type: String, default: 'USD' },
    status: {
      type: String,
      enum: ['open', 'won', 'lost'],
      default: 'open'
    },
    expected_close_date: { type: Date },
    stage_id: { type: Schema.Types.ObjectId, ref: 'PipelineStage' },
    source: { type: String },
    industry: { type: String },
    description: { type: String },
    company_id: { type: Schema.Types.ObjectId, ref: 'Company' },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact' },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    stage_changed_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

DealSchema.index({ organization_id: 1, stage_id: 1 });
DealSchema.index({ organization_id: 1, owner_id: 1 });
DealSchema.index({ organization_id: 1, company_id: 1 });

export const Deal = mongoose.model<IDeal>('Deal', DealSchema);
