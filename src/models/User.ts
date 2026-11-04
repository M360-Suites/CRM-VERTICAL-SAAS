/**
 * User model for authentication and user management
 * Handles user data, password hashing, and authentication
 */
import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User roles in the system
 * - admin: Full system access
 * - sales_manager: Manage sales team and deals
 * - sales_rep: Create and manage own contacts/deals
 * - viewer: Read-only access
 */
export type UserRole = 'admin' | 'sales_manager' | 'sales_rep' | 'viewer';

/**
 * User document interface
 * Extends Mongoose Document with typed fields
 */
export interface IUser extends Document {
  email: string;
  password: string;
  display_name: string;
  avatar_url?: string;
  role: UserRole;
  organization_id: mongoose.Types.ObjectId;
  is_active: boolean;
  /** Set when an admin deactivates the account; is_active alone also means "email not verified yet" */
  deactivated_at?: Date | null;
  google_access_token?: string;
  google_refresh_token?: string;
  gmail_sync_enabled: boolean;
  last_gmail_sync_at?: Date;
  created_at: Date;
  updated_at: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

/**
 * User schema definition
 * Defines fields, validation, and timestamps
 */
const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    display_name: { type: String, required: true },
    avatar_url: { type: String },
    role: {
      type: String,
      enum: ['admin', 'sales_manager', 'sales_rep', 'viewer'],
      default: 'viewer'
    },
    organization_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    is_active: { type: Boolean, default: true },
    deactivated_at: { type: Date, default: null },
    google_access_token: { type: String },
    google_refresh_token: { type: String },
    gmail_sync_enabled: { type: Boolean, default: false },
    last_gmail_sync_at: { type: Date }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

UserSchema.index({ organization_id: 1, role: 1 });

/**
 * Pre-save middleware to hash password
 * Hashes password before saving if modified
 */
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Compare candidate password with stored hash
 * @param candidatePassword - Plain text password to compare
 * @returns True if password matches
 */
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
