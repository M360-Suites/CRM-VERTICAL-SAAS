/**
 * StageMessage model for internal stage discussion
 * Flat comment/chat thread attached to a pipeline stage
 * Only users assigned to the stage can read and post
 */
import mongoose, { Document, Schema } from 'mongoose';

/**
 * StageMessage document interface
 * Extends Mongoose Document with typed fields
 */
export interface IStageMessage extends Document {
  stage_id: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  sender_id: mongoose.Types.ObjectId;
  content: string;
  edited: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * StageMessage schema definition
 * Defines fields, validation, and timestamps
 */
const StageMessageSchema = new Schema<IStageMessage>(
  {
    stage_id: { type: Schema.Types.ObjectId, ref: 'PipelineStage', required: true },
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    sender_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: [5000, 'Message cannot exceed 5000 characters']
    },
    edited: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

StageMessageSchema.index({ stage_id: 1, created_at: 1 });
StageMessageSchema.index({ organization_id: 1, created_at: -1 });

export const StageMessage = mongoose.model<IStageMessage>('StageMessage', StageMessageSchema);
