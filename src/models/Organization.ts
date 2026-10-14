import mongoose, { Document, Schema } from 'mongoose';

/**
 * How new inbound leads get an owner:
 * - auto: routing rules, then the least-loaded rep
 * - manual: leads land unassigned until an admin or sales manager assigns them
 */
export type AssignmentMode = 'auto' | 'manual';
export const ASSIGNMENT_MODES: AssignmentMode[] = ['auto', 'manual'];

export interface IOrganization extends Document {
  name: string;
  slug: string;
  owner_id?: mongoose.Types.ObjectId;
  is_active: boolean;
  publicKey?: string;
  secretKey?: string;
  assignment_mode: AssignmentMode;
  created_at: Date;
  updated_at: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
    is_active: { type: Boolean, default: true },
    publicKey: { type: String, unique: true, sparse: true },
    secretKey: { type: String, unique: true, sparse: true },
    assignment_mode: { type: String, enum: ASSIGNMENT_MODES, default: 'auto' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

OrganizationSchema.index({ slug: 1 }, { unique: true });
OrganizationSchema.index({ publicKey: 1 }, { unique: true, sparse: true });

export const Organization = mongoose.model<IOrganization>('Organization', OrganizationSchema);
