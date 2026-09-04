import crypto from 'crypto';
import mongoose from 'mongoose';
import { IUser } from '../models/User';
import { Organization } from '../models/Organization';
import { generateApiKeys } from './apiKeys';
import { seedDefaultPipelineForOrganization } from '../seeds/pipelineSeed';

const createSlug = (value: string): string => (
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `org-${Date.now()}`
);

export const ensureUserOrganization = async (user: IUser): Promise<mongoose.Types.ObjectId> => {
  if (user.organization_id) return user.organization_id;

  const organization = await Organization.create({
    name: user.display_name || user.email.split('@')[0],
    slug: `${createSlug(user.display_name || user.email)}-${crypto.randomBytes(3).toString('hex')}`,
    owner_id: user._id,
    ...generateApiKeys()
  });

  user.organization_id = organization._id as mongoose.Types.ObjectId;
  await user.save();
  await seedDefaultPipelineForOrganization(organization._id as mongoose.Types.ObjectId);

  return organization._id as mongoose.Types.ObjectId;
};

export const makeOrganizationSlug = createSlug;
