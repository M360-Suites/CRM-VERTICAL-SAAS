/**
 * Contact model for CRM contacts
 * Represents individuals/people in the system
 */
import mongoose, { Document, Schema } from 'mongoose';

/**
 * Contact temperature indicating likelihood of conversion
 * - hot: High likelihood of conversion
 * - warm: Moderate likelihood
 * - cold: Low likelihood
 */
export type Temperature = 'hot' | 'warm' | 'cold';

export type RoutingMode = 'rule' | 'balanced' | 'unassigned';

/** Why a contact no longer receives marketing/automated email */
export type EmailOptOutReason = 'unsubscribed' | 'bounced' | 'complained';

/**
 * Stamped by the Revenue Engine when a lead is auto-routed on creation
 */
export interface ILeadRouting {
  intent_score: number;
  region?: string;
  tier?: string;
  platform?: string;
  source?: string;
  rule_id?: mongoose.Types.ObjectId;
  rule_name?: string;
  mode: RoutingMode;
  routed_at: Date;
}

/**
 * Contact document interface
 * Extends Mongoose Document with typed fields
 */
export interface IContact extends Document {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  role_title?: string;
  company_id?: mongoose.Types.ObjectId;
  owner_id?: mongoose.Types.ObjectId;
  organization_id: mongoose.Types.ObjectId;
  temperature: Temperature;
  tags: string[];
  last_contacted_at?: Date;
  routing?: ILeadRouting;
  email_opt_out: boolean;
  email_opt_out_reason?: EmailOptOutReason;
  email_opt_out_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Contact schema definition
 * Defines fields, validation, and indexes
 */
const ContactSchema = new Schema<IContact>(
  {
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    role_title: { type: String },
    company_id: { type: Schema.Types.ObjectId, ref: 'Company' },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User' },
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    temperature: {
      type: String,
      enum: ['hot', 'warm', 'cold'],
      default: 'warm'
    },
    tags: [{ type: String }],
    last_contacted_at: { type: Date },
    routing: {
      type: new Schema<ILeadRouting>(
        {
          intent_score: { type: Number },
          region: { type: String },
          tier: { type: String },
          platform: { type: String },
          source: { type: String },
          rule_id: { type: Schema.Types.ObjectId, ref: 'RoutingRule' },
          rule_name: { type: String },
          mode: { type: String, enum: ['rule', 'balanced', 'unassigned'] },
          routed_at: { type: Date }
        },
        { _id: false }
      )
    },
    email_opt_out: { type: Boolean, default: false },
    email_opt_out_reason: { type: String, enum: ['unsubscribed', 'bounced', 'complained'] },
    email_opt_out_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

ContactSchema.index({ organization_id: 1, first_name: 1, last_name: 1 });
ContactSchema.index({ organization_id: 1, email: 1 });
ContactSchema.index({ organization_id: 1, company_id: 1 });
ContactSchema.index({ organization_id: 1, owner_id: 1 });
ContactSchema.index({ organization_id: 1, temperature: 1 });
ContactSchema.index({ organization_id: 1, 'routing.routed_at': -1 });

export const Contact = mongoose.model<IContact>('Contact', ContactSchema);
