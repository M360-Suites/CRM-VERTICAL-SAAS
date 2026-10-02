/**
 * NurtureDraft model
 * AI or template-generated message waiting for human approval. Nothing is sent until approved.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { NURTURE_CHANNELS, NurtureChannel } from './NurtureTemplate';

export const DRAFT_STATUSES = ['pending', 'approved', 'rejected', 'sent'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface INurtureDraft extends Document {
  organization_id: mongoose.Types.ObjectId;
  contact_id?: mongoose.Types.ObjectId;
  template_id?: mongoose.Types.ObjectId;
  assignee_id?: mongoose.Types.ObjectId;
  channel: NurtureChannel;
  subject?: string;
  body: string;
  status: DraftStatus;
  intent_score?: number;
  latency_ms?: number;
  prompt_log?: string;
  ai_model?: string;
  reviewed_by?: mongoose.Types.ObjectId;
  reviewed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const NurtureDraftSchema = new Schema<INurtureDraft>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact' },
    template_id: { type: Schema.Types.ObjectId, ref: 'NurtureTemplate' },
    assignee_id: { type: Schema.Types.ObjectId, ref: 'User' },
    channel: { type: String, enum: NURTURE_CHANNELS, default: 'email' },
    subject: { type: String },
    body: { type: String, required: true },
    status: { type: String, enum: DRAFT_STATUSES, default: 'pending' },
    intent_score: { type: Number },
    latency_ms: { type: Number },
    prompt_log: { type: String },
    ai_model: { type: String },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewed_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

NurtureDraftSchema.index({ organization_id: 1, status: 1, created_at: -1 });
NurtureDraftSchema.index({ organization_id: 1, contact_id: 1 });

export const NurtureDraft = mongoose.model<INurtureDraft>('NurtureDraft', NurtureDraftSchema, 'nurture_drafts');
