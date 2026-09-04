import mongoose from 'mongoose';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { Organization } from '../models/Organization';
import { logger } from '../config/logger';

const DEFAULT_STAGES = [
  { name: 'Lead', order: 1, is_won: false, is_lost: false },
  { name: 'Qualified', order: 2, is_won: false, is_lost: false },
  { name: 'Proposal', order: 3, is_won: false, is_lost: false },
  { name: 'Negotiation', order: 4, is_won: false, is_lost: false },
  { name: 'Won', order: 5, is_won: true, is_lost: false },
  { name: 'Lost', order: 6, is_won: false, is_lost: true }
];

export const seedDefaultPipelineForOrganization = async (organizationId: mongoose.Types.ObjectId): Promise<void> => {
  const existingPipeline = await Pipeline.findOne({ organization_id: organizationId, is_default: true });
  if (existingPipeline) return;

  const pipeline = new Pipeline({
    name: 'Sales Pipeline',
    description: 'Default sales pipeline',
    is_default: true,
    organization_id: organizationId
  });

  await pipeline.save();

  const stages = DEFAULT_STAGES.map(stage => ({
    ...stage,
    pipeline_id: pipeline._id,
    organization_id: organizationId,
    assignees: []
  }));

  await PipelineStage.insertMany(stages);
};

export const seedPipeline = async (): Promise<void> => {
  try {
    const organizations = await Organization.find({ is_active: true }).select('_id').lean();
    await Promise.all(organizations.map((organization) =>
      seedDefaultPipelineForOrganization(organization._id as mongoose.Types.ObjectId)
    ));

    logger.info('Default pipelines checked successfully');
  } catch (error) {
    logger.error({ err: error }, 'Error seeding pipeline');
  }
};

if (require.main === module) {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/crm';
  
  mongoose.connect(mongoUri)
    .then(() => seedPipeline())
    .then(() => mongoose.disconnect())
    .catch((error) => logger.error({ err: error }, 'Pipeline seed failed'));
}
