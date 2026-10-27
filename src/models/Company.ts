/**
 * Company model for CRM companies
 * Represents organizations/businesses
 */
import mongoose, { Document, Schema } from 'mongoose';

/**
 * Company document interface
 * Extends Mongoose Document with typed fields
 */
export interface ICompany extends Document {
  name: string;
  industry?: string;
  website?: string;
  notes?: string;
  owner_id?: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Extra columns captured from CSV imports */
  custom_fields?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Company schema definition
 * Defines fields, validation, and indexes
 */
const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true },
    industry: { type: String },
    website: { type: String },
    notes: { type: String },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    contact_person: { type: String },
    email: { type: String },
    phone: { type: String },
    address: { type: String },
    custom_fields: { type: Schema.Types.Mixed, default: {} }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

CompanySchema.index({ organization_id: 1, name: 1 });
CompanySchema.index({ organization_id: 1, owner_id: 1 });

export const Company = mongoose.model<ICompany>('Company', CompanySchema);
