import mongoose, { Document, Schema } from 'mongoose';

export type NotificationProvider = 'whatsapp' | 'instagram' | 'facebook_messenger' | 'internal';

export type NotificationType = 'new_message' | 'connection_request' | 'mention' | 'stage_message';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  provider: NotificationProvider;
  type: NotificationType;
  title: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  created_at: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: {
      type: String,
      enum: ['whatsapp', 'instagram', 'facebook_messenger', 'internal'],
      required: true
    },
    type: {
      type: String,
      enum: ['new_message', 'connection_request', 'mention', 'stage_message'],
      default: 'new_message'
    },
    title: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    read: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false }
  }
);

NotificationSchema.index({ userId: 1, read: 1, created_at: -1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
