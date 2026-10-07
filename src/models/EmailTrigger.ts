/**
 * EmailTrigger model
 * A user-configured automation: when a deal event happens, email a template.
 *  - deal.stage_entered: a deal lands in `stage_id`
 *  - deal.created:       a new deal is added to the pipeline
 *  - deal.won / deal.lost
 */
import mongoose, { Document, Schema } from 'mongoose';

export const TRIGGER_EVENTS = ['deal.stage_entered', 'deal.created', 'deal.won', 'deal.lost'] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_RECIPIENTS = ['contact', 'deal_owner'] as const;
export type TriggerRecipient = (typeof TRIGGER_RECIPIENTS)[number];

/** Upper bound on the send delay: 90 days */
export const MAX_TRIGGER_DELAY_MINUTES = 60 * 24 * 90;

export interface IEmailTrigger extends Document {
  organization_id: mongoose.Types.ObjectId;
  name: string;
  event: TriggerEvent;
  pipeline_id?: mongoose.Types.ObjectId;
  stage_id?: mongoose.Types.ObjectId;
  template_id: mongoose.Types.ObjectId;
  recipient: TriggerRecipient;
  delay_minutes: number;
  min_deal_value?: number;
  is_active: boolean;
  sent_count: number;
  last_fired_at?: Date;
  created_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const EmailTriggerSchema = new Schema<IEmailTrigger>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    event: { type: String, enum: TRIGGER_EVENTS, required: true },
    pipeline_id: { type: Schema.Types.ObjectId, ref: 'Pipeline' },
    stage_id: { type: Schema.Types.ObjectId, ref: 'PipelineStage' },
    template_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', required: true },
    recipient: { type: String, enum: TRIGGER_RECIPIENTS, default: 'contact' },
    delay_minutes: { type: Number, default: 0, min: 0, max: MAX_TRIGGER_DELAY_MINUTES },
    min_deal_value: { type: Number, min: 0 },
    is_active: { type: Boolean, default: true },
    sent_count: { type: Number, default: 0 },
    last_fired_at: { type: Date },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

EmailTriggerSchema.index({ organization_id: 1, event: 1, is_active: 1 });

export const EmailTrigger = mongoose.model<IEmailTrigger>('EmailTrigger', EmailTriggerSchema);
