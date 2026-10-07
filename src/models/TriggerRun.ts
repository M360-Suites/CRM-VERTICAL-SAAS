/**
 * TriggerRun model
 * One firing of an EmailTrigger for a deal. Doubles as the delayed-send queue:
 * the dispatcher picks up `scheduled` runs once `send_at` has passed.
 * The unique `dedupe_key` stops a deal bouncing between stages from re-sending.
 */
import mongoose, { Document, Schema } from 'mongoose';
import { TRIGGER_EVENTS, type TriggerEvent } from './EmailTrigger';

export type TriggerRunStatus = 'scheduled' | 'sending' | 'sent' | 'skipped' | 'failed';

export interface ITriggerRun extends Document {
  organization_id: mongoose.Types.ObjectId;
  trigger_id: mongoose.Types.ObjectId;
  deal_id: mongoose.Types.ObjectId;
  stage_id?: mongoose.Types.ObjectId;
  event: TriggerEvent;
  dedupe_key: string;
  status: TriggerRunStatus;
  send_at: Date;
  to_email?: string;
  subject?: string;
  ses_message_id?: string;
  error?: string;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const TriggerRunSchema = new Schema<ITriggerRun>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    trigger_id: { type: Schema.Types.ObjectId, ref: 'EmailTrigger', required: true },
    deal_id: { type: Schema.Types.ObjectId, ref: 'Deal', required: true },
    stage_id: { type: Schema.Types.ObjectId, ref: 'PipelineStage' },
    event: { type: String, enum: TRIGGER_EVENTS, required: true },
    dedupe_key: { type: String, required: true },
    status: { type: String, enum: ['scheduled', 'sending', 'sent', 'skipped', 'failed'], default: 'scheduled' },
    send_at: { type: Date, required: true },
    to_email: { type: String },
    subject: { type: String },
    ses_message_id: { type: String },
    error: { type: String },
    sent_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

TriggerRunSchema.index({ dedupe_key: 1 }, { unique: true });
TriggerRunSchema.index({ status: 1, send_at: 1 });
TriggerRunSchema.index({ organization_id: 1, trigger_id: 1, created_at: -1 });

export const TriggerRun = mongoose.model<ITriggerRun>('TriggerRun', TriggerRunSchema);
