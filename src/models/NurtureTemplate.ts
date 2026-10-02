/**
 * NurtureTemplate model
 * Approved message templates the AI adapts; fallbacks are used verbatim when AI is unavailable
 */
import mongoose, { Document, Schema } from 'mongoose';

export const NURTURE_CHANNELS = ['email', 'whatsapp', 'sms'] as const;
export type NurtureChannel = (typeof NURTURE_CHANNELS)[number];

export interface INurtureTemplate extends Document {
  organization_id: mongoose.Types.ObjectId;
  name: string;
  channel: NurtureChannel;
  tone?: string;
  stage?: string;
  subject?: string;
  body: string;
  is_fallback: boolean;
  is_approved: boolean;
  created_at: Date;
  updated_at: Date;
}

const NurtureTemplateSchema = new Schema<INurtureTemplate>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    channel: { type: String, enum: NURTURE_CHANNELS, default: 'email' },
    tone: { type: String },
    stage: { type: String },
    subject: { type: String },
    body: { type: String, required: true },
    is_fallback: { type: Boolean, default: false },
    is_approved: { type: Boolean, default: true }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

NurtureTemplateSchema.index({ organization_id: 1, channel: 1, is_approved: 1 });

export const NurtureTemplate = mongoose.model<INurtureTemplate>('NurtureTemplate', NurtureTemplateSchema, 'nurture_templates');
