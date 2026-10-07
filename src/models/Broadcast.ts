/**
 * Broadcast model
 * A bulk email sent through Amazon SES to an audience of contacts.
 * Recipients are snapshotted into BroadcastRecipient when the send starts,
 * so the history reflects exactly who it went to.
 */
import mongoose, { Document, Schema } from 'mongoose';
import type { Temperature } from './Contact';

export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface IBroadcastAudience {
  all?: boolean;
  tags?: string[];
  temperature?: Temperature[];
  owner_ids?: mongoose.Types.ObjectId[];
  company_ids?: mongoose.Types.ObjectId[];
  contact_ids?: mongoose.Types.ObjectId[];
}

export interface IBroadcastStats {
  total: number;
  sent: number;
  failed: number;
  bounced: number;
  complained: number;
  skipped: number;
}

export interface IBroadcast extends Document {
  organization_id: mongoose.Types.ObjectId;
  name: string;
  subject: string;
  preview_text?: string;
  html: string;
  template_id?: mongoose.Types.ObjectId;
  audience: IBroadcastAudience;
  status: BroadcastStatus;
  scheduled_at?: Date;
  started_at?: Date;
  completed_at?: Date;
  stats: IBroadcastStats;
  error?: string;
  created_by?: mongoose.Types.ObjectId;
  sent_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    preview_text: { type: String, trim: true, maxlength: 300 },
    html: { type: String, required: true },
    template_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplate' },
    audience: {
      type: new Schema<IBroadcastAudience>(
        {
          all: { type: Boolean, default: false },
          tags: [{ type: String }],
          temperature: [{ type: String, enum: ['hot', 'warm', 'cold'] }],
          owner_ids: [{ type: Schema.Types.ObjectId, ref: 'User' }],
          company_ids: [{ type: Schema.Types.ObjectId, ref: 'Company' }],
          contact_ids: [{ type: Schema.Types.ObjectId, ref: 'Contact' }]
        },
        { _id: false }
      ),
      default: () => ({ all: true })
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'],
      default: 'draft'
    },
    scheduled_at: { type: Date },
    started_at: { type: Date },
    completed_at: { type: Date },
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      complained: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 }
    },
    error: { type: String },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
    sent_by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

BroadcastSchema.index({ organization_id: 1, created_at: -1 });
BroadcastSchema.index({ status: 1, scheduled_at: 1 });

export const Broadcast = mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);
