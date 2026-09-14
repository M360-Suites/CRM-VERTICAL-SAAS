/**
 * Site model — tracks which websites/domains are connected to an organization's public API key.
 */
import mongoose, { Document, Schema } from 'mongoose';

export type SiteSource = 'header' | 'explicit' | 'manual';

export interface ISite extends Document {
  organization_id: mongoose.Types.ObjectId;
  domain: string;
  source: SiteSource;
  is_active: boolean;
  request_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

const SiteSchema = new Schema<ISite>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    domain: { type: String, required: true, trim: true, lowercase: true },
    source: {
      type: String,
      enum: ['header', 'explicit', 'manual'],
      default: 'header'
    },
    is_active: { type: Boolean, default: true },
    request_count: { type: Number, default: 0 },
    first_seen_at: { type: Date },
    last_seen_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

SiteSchema.index({ organization_id: 1, domain: 1 }, { unique: true });
SiteSchema.index({ organization_id: 1, last_seen_at: -1 });

export const Site = mongoose.model<ISite>('Site', SiteSchema);