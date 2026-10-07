/**
 * BroadcastRecipient model
 * Per-contact delivery record for a Broadcast — the send queue and the history.
 */
import mongoose, { Document, Schema } from 'mongoose';

export type BroadcastRecipientStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced' | 'complained' | 'skipped';

export interface IBroadcastRecipient extends Document {
  organization_id: mongoose.Types.ObjectId;
  broadcast_id: mongoose.Types.ObjectId;
  contact_id: mongoose.Types.ObjectId;
  email: string;
  name?: string;
  status: BroadcastRecipientStatus;
  ses_message_id?: string;
  error?: string;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const BroadcastRecipientSchema = new Schema<IBroadcastRecipient>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    broadcast_id: { type: Schema.Types.ObjectId, ref: 'Broadcast', required: true },
    contact_id: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String },
    status: {
      type: String,
      enum: ['queued', 'sending', 'sent', 'failed', 'bounced', 'complained', 'skipped'],
      default: 'queued'
    },
    ses_message_id: { type: String },
    error: { type: String },
    sent_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

BroadcastRecipientSchema.index({ broadcast_id: 1, email: 1 }, { unique: true });
BroadcastRecipientSchema.index({ broadcast_id: 1, status: 1 });
BroadcastRecipientSchema.index({ ses_message_id: 1 }, { sparse: true });

export const BroadcastRecipient = mongoose.model<IBroadcastRecipient>('BroadcastRecipient', BroadcastRecipientSchema);
