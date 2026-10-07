/**
 * EmailTemplate model
 * Reusable email designed in the template canvas — used by triggers and broadcasts.
 * `design` is the editor's own JSON (opaque to the backend) so the canvas can reload it;
 * `html` is the rendered output that actually gets sent.
 */
import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailTemplate extends Document {
  organization_id: mongoose.Types.ObjectId;
  name: string;
  subject: string;
  preview_text?: string;
  html: string;
  design?: unknown;
  created_by?: mongoose.Types.ObjectId;
  updated_by?: mongoose.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const EmailTemplateSchema = new Schema<IEmailTemplate>(
  {
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    preview_text: { type: String, trim: true, maxlength: 300 },
    html: { type: String, required: true },
    design: { type: Schema.Types.Mixed },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

EmailTemplateSchema.index({ organization_id: 1, updated_at: -1 });

export const EmailTemplate = mongoose.model<IEmailTemplate>('EmailTemplate', EmailTemplateSchema);
