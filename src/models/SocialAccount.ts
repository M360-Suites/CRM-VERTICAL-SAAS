import mongoose, { Document, Schema } from 'mongoose';

export type SocialProvider = 'whatsapp' | 'instagram' | 'facebook_messenger';

export type SocialAccountStatus = 'connected' | 'disconnected' | 'expired';

export interface ISocialAccount extends Document {
  userId: mongoose.Types.ObjectId;
  provider: SocialProvider;
  accountId: string;
  status: SocialAccountStatus;
  connectedAt: Date;
  created_at: Date;
  updated_at: Date;
}

const SocialAccountSchema = new Schema<ISocialAccount>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: {
      type: String,
      enum: ['whatsapp', 'instagram', 'facebook_messenger'],
      required: true
    },
    accountId: { type: String, required: true },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'expired'],
      default: 'connected'
    },
    connectedAt: { type: Date, default: Date.now }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

SocialAccountSchema.index({ userId: 1, provider: 1 });
SocialAccountSchema.index({ accountId: 1 }, { unique: true });

export const SocialAccount = mongoose.model<ISocialAccount>('SocialAccount', SocialAccountSchema);
