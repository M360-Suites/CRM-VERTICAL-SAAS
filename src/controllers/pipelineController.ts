import { Response } from 'express';
import mongoose from 'mongoose';
import { Activity } from '../models/Activity';
import { Deal } from '../models/Deal';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { User } from '../models/User';
import { ApiResponse, AuthRequest } from '../types';
import { requireOrganization } from '../utils/tenant';

const isValidObjectId = (value: unknown): value is string =>
  typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

const normalizeName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const canEditDeal = (req: AuthRequest, deal: { owner_id?: unknown }): boolean => {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'sales_manager') return true;
  return req.user.role === 'sales_rep' && deal.owner_id?.toString() === req.user.id;
};

const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

const getDefaultPipeline = async (organizationId: mongoose.Types.ObjectId) =>
  Pipeline.findOne({ organization_id: organizationId, is_default: true }).lean();

const getOrderedStages = async (organizationId: mongoose.Types.ObjectId) => {
  const pipeline = await getDefaultPipeline(organizationId);
  if (!pipeline) return null;

  return PipelineStage.find({ pipeline_id: pipeline._id, organization_id: organizationId })
    .sort({ order: 1 })
    .lean();
};

const formatStage = (stage: {
  _id: unknown;
  name: string;
  order: number;
  is_won: boolean;
  is_lost: boolean;
}) => ({
  id: stage._id,
  name: stage.name,
  position: stage.order,
  is_won: stage.is_won,
  is_lost: stage.is_lost
});

const formatTeamMember = (user: {
  _id: unknown;
  display_name?: string;
  email: string;
}) => ({
  id: user._id,
  name: user.display_name || user.email,
  display_name: user.display_name,
  email: user.email
});

const formatDeal = (deal: {
  _id: unknown;
  title: string;
  value?: number;
  source?: string;
  industry?: string;
  stage_id?: unknown;
  company_id?: unknown;
  stage_changed_at?: Date;
  created_at?: Date;
  updated_at?: Date;
}) => {
  const company =
    typeof deal.company_id === 'object' && deal.company_id && '_id' in deal.company_id
      ? deal.company_id as { _id: unknown; name?: string }
      : null;

  return {
    id: deal._id,
    title: deal.title,
    value: deal.value,
    source: deal.source,
    industry: deal.industry,
    stage_id:
      typeof deal.stage_id === 'object' && deal.stage_id && '_id' in deal.stage_id
        ? (deal.stage_id as { _id: unknown })._id
        : deal.stage_id,
    company: company
      ? {
          id: company._id,
          name: company.name
        }
      : null,
    stage_changed_at: deal.stage_changed_at,
    created_at: deal.created_at,
    updated_at: deal.updated_at
  };
};

const getFirstStageId = async (organizationId: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId | null> => {
  const stages = await getOrderedStages(organizationId);
  if (!stages || stages.length === 0) return null;
  return stages[0]._id as mongoose.Types.ObjectId;
};

export const getPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const stages = await getOrderedStages(organizationId);
    if (!stages) {
      res.status(404).json({ status: false, message: 'No pipeline found' });
      return;
    }

    const stageIds = stages.map((stage) => stage._id);
    const [deals, teamMembers] = await Promise.all([
      Deal.find({ organization_id: organizationId, stage_id: { $in: stageIds } })
        .populate('company_id', 'name')
        .sort({ created_at: -1 })
        .lean(),
      User.find({ organization_id: organizationId, is_active: true })
        .select('email display_name')
        .sort({ display_name: 1, email: 1 })
        .lean()
    ]);

    const formattedDeals = deals.map(formatDeal);
    const formattedTeamMembers = teamMembers.map(formatTeamMember);
    const teamMemberById = new Map(
      formattedTeamMembers.map((member) => [member.id?.toString(), member])
    );

    const response: ApiResponse<{
      stages: Array<Record<string, unknown>>;
      team_members: ReturnType<typeof formatTeamMember>[];
    }> = {
      status: true,
      message: 'Pipeline retrieved successfully',
      data: {
        stages: stages.map((stage) => {
          const stageDeals = formattedDeals.filter((deal) => deal.stage_id?.toString() === stage._id.toString());
          const assignedTo = stage.assignees?.[0]
            ? teamMemberById.get(stage.assignees[0].toString()) || null
            : null;

          return {
            id: stage._id,
            name: stage.name,
            total_deals: stageDeals.length,
            total_value: stageDeals.reduce((total, deal) => total + (Number(deal.value) || 0), 0),
            position: stage.order,
            is_won: stage.is_won,
            is_lost: stage.is_lost,
            assignedTo,
            deals: stageDeals
          };
        }),
        team_members: formattedTeamMembers
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch pipeline' });
  }
};

export const getPipelineStages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const stages = await getOrderedStages(organizationId);
    if (!stages) {
      res.status(404).json({ message: 'No pipeline found' });
      return;
    }

    res.json(stages.map(formatStage));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch pipeline stages' });
  }
};

export const getPipelineDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const stages = await getOrderedStages(organizationId);
    if (!stages) {
      res.status(404).json({ message: 'No pipeline found' });
      return;
    }

    const deals = await Deal.find({
      organization_id: organizationId,
      stage_id: { $in: stages.map((stage) => stage._id) }
    })
      .populate('company_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'Pipeline deals retrieved successfully',
      data: deals.map(formatDeal)
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch pipeline deals' });
  }
};

interface DealBody {
  title?: string;
  value?: number;
  source?: string;
  industry?: string;
  stage_id?: string;
  company_id?: string | null;
}

export const createPipelineDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const body = req.body as DealBody;
    const title = normalizeName(body.title);
    if (!title) {
      res.status(400).json({ message: 'title is required' });
      return;
    }

    let stageId: mongoose.Types.ObjectId | null = null;
    if (body.stage_id) {
      if (!isValidObjectId(body.stage_id)) {
        res.status(400).json({ message: 'Invalid stage_id' });
        return;
      }

      const stageExists = await PipelineStage.exists({ _id: body.stage_id, organization_id: organizationId });
      if (!stageExists) {
        res.status(404).json({ message: 'Stage not found' });
        return;
      }

      stageId = toObjectId(body.stage_id);
    } else {
      stageId = await getFirstStageId(organizationId);
      if (!stageId) {
        res.status(404).json({ message: 'No pipeline stage found' });
        return;
      }
    }

    if (body.company_id && !isValidObjectId(body.company_id)) {
      res.status(400).json({ message: 'Invalid company_id' });
      return;
    }

    const deal = await Deal.create({
      title,
      value: body.value,
      source: body.source,
      industry: body.industry,
      stage_id: stageId,
      company_id: body.company_id ? toObjectId(body.company_id) : undefined,
      owner_id: req.user?.id ? toObjectId(req.user.id) : undefined,
      organization_id: organizationId,
      stage_changed_at: new Date()
    });

    const populatedDeal = await Deal.findById(deal._id).populate('company_id', 'name').lean();
    res.status(201).json(populatedDeal ? formatDeal(populatedDeal) : deal);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create pipeline deal' });
  }
};

export const updatePipelineDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { dealId } = req.params as { dealId: string };
    if (!isValidObjectId(dealId)) {
      res.status(400).json({ message: 'Invalid deal ID' });
      return;
    }

    const existingDeal = await Deal.findOne({ _id: dealId, organization_id: organizationId }).select('owner_id').lean();
    if (!existingDeal) {
      res.status(404).json({ message: 'Deal not found' });
      return;
    }

    if (!canEditDeal(req, existingDeal)) {
      res.status(403).json({ message: "You don't have permission to update this deal" });
      return;
    }

    const body = req.body as DealBody;
    const update: Record<string, unknown> = {};

    if (body.title !== undefined) {
      const title = normalizeName(body.title);
      if (!title) {
        res.status(400).json({ message: 'title cannot be empty' });
        return;
      }
      update.title = title;
    }

    if (body.value !== undefined) update.value = body.value;
    if (body.source !== undefined) update.source = body.source;
    if (body.industry !== undefined) update.industry = body.industry;

    if (body.company_id !== undefined) {
      if (body.company_id !== null && !isValidObjectId(body.company_id)) {
        res.status(400).json({ message: 'Invalid company_id' });
        return;
      }
      update.company_id = body.company_id ? toObjectId(body.company_id) : null;
    }

    if (body.stage_id !== undefined) {
      if (!isValidObjectId(body.stage_id)) {
        res.status(400).json({ message: 'Invalid stage_id' });
        return;
      }

      const stage = await PipelineStage.exists({ _id: body.stage_id, organization_id: organizationId });
      if (!stage) {
        res.status(404).json({ message: 'Stage not found' });
        return;
      }

      update.stage_id = toObjectId(body.stage_id);
      update.stage_changed_at = new Date();
    }

    const deal = await Deal.findOneAndUpdate(
      { _id: dealId, organization_id: organizationId },
      { $set: update },
      { new: true, runValidators: true }
    ).populate('company_id', 'name').lean();

    res.json({
      status: true,
      message: 'Deal updated successfully',
      data: deal ? formatDeal(deal) : null
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update pipeline deal' });
  }
};

export const movePipelineDealStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { dealId } = req.params as { dealId: string };
    const { stage_id } = req.body as { stage_id?: string };

    if (!isValidObjectId(dealId)) {
      res.status(400).json({ message: 'Invalid deal ID' });
      return;
    }

    if (!isValidObjectId(stage_id)) {
      res.status(400).json({ message: 'Invalid stage_id' });
      return;
    }

    const [existingDeal, stage] = await Promise.all([
      Deal.findOne({ _id: dealId, organization_id: organizationId }).select('owner_id').lean(),
      PipelineStage.findOne({ _id: stage_id, organization_id: organizationId }).select('name').lean()
    ]);

    if (!existingDeal) {
      res.status(404).json({ message: 'Deal not found' });
      return;
    }

    if (!canEditDeal(req, existingDeal)) {
      res.status(403).json({ message: "You don't have permission to move this deal" });
      return;
    }

    if (!stage) {
      res.status(404).json({ message: 'Stage not found' });
      return;
    }

    const stageChangedAt = new Date();
    const deal = await Deal.findOneAndUpdate(
      { _id: dealId, organization_id: organizationId },
      {
        $set: {
          stage_id: toObjectId(stage_id),
          stage_changed_at: stageChangedAt
        }
      },
      { new: true }
    ).populate('company_id', 'name').lean();

    await Activity.create({
      deal_id: toObjectId(dealId),
      type: 'stage_change',
      content: `Moved to ${stage.name}`,
      user_id: req.user?.id ? toObjectId(req.user.id) : undefined,
      organization_id: organizationId,
      metadata: {
        stage_id,
        stage_name: stage.name,
        stage_changed_at: stageChangedAt
      }
    });

    res.json(deal ? formatDeal(deal) : null);
  } catch (error) {
    res.status(500).json({ message: 'Failed to move pipeline deal' });
  }
};

export const deletePipelineDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { dealId } = req.params as { dealId: string };
    if (!isValidObjectId(dealId)) {
      res.status(400).json({ message: 'Invalid deal ID' });
      return;
    }

    const deal = await Deal.findOneAndDelete({ _id: dealId, organization_id: organizationId });
    if (!deal) {
      res.status(404).json({ message: 'Deal not found' });
      return;
    }

    res.json({ message: 'Deal deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete pipeline deal' });
  }
};

export const getPipelineTeamMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const users = await User.find({ organization_id: organizationId, is_active: true })
      .select('email display_name')
      .sort({ display_name: 1, email: 1 })
      .lean();

    res.json(users.map((user) => ({
      id: user._id,
      display_name: user.display_name,
      email: user.email
    })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch team members' });
  }
};

export const getPipelineStageAssignees = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const stages = await getOrderedStages(organizationId);
    if (!stages) {
      res.status(404).json({ message: 'No pipeline found' });
      return;
    }

    res.json(stages.flatMap((stage) =>
      (stage.assignees || []).map((userId) => ({
        stage_id: stage._id,
        user_id: userId
      }))
    ));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch stage assignees' });
  }
};

export const assignPipelineStageMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId } = req.params as { stageId: string };
    const { user_id } = req.body as { user_id?: string };

    if (!isValidObjectId(stageId) || !isValidObjectId(user_id)) {
      res.status(400).json({ message: 'Valid stageId and user_id are required' });
      return;
    }

    const user = await User.exists({ _id: user_id, organization_id: organizationId, is_active: true });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const stage = await PipelineStage.findOneAndUpdate(
      { _id: stageId, organization_id: organizationId },
      { $addToSet: { assignees: toObjectId(user_id) } },
      { new: true }
    ).lean();

    if (!stage) {
      res.status(404).json({ message: 'Stage not found' });
      return;
    }

    res.status(201).json({ stage_id: stage._id, user_id });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign team member' });
  }
};

export const removePipelineStageMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId, userId } = req.params as { stageId: string; userId: string };
    if (!isValidObjectId(stageId) || !isValidObjectId(userId)) {
      res.status(400).json({ message: 'Valid stageId and userId are required' });
      return;
    }

    const stage = await PipelineStage.findOneAndUpdate(
      { _id: stageId, organization_id: organizationId },
      { $pull: { assignees: toObjectId(userId) } },
      { new: true }
    );

    if (!stage) {
      res.status(404).json({ message: 'Stage not found' });
      return;
    }

    res.json({ message: 'Stage assignee removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to remove stage assignee' });
  }
};

export const getPipelineDealActivities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { dealId } = req.params as { dealId: string };
    if (!isValidObjectId(dealId)) {
      res.status(400).json({ message: 'Invalid deal ID' });
      return;
    }

    const activities = await Activity.find({ deal_id: dealId, organization_id: organizationId })
      .sort({ created_at: -1 })
      .lean();

    res.json(activities.map((activity) => ({
      id: activity._id,
      deal_id: activity.deal_id,
      type: activity.type,
      content: activity.content,
      created_at: activity.created_at
    })));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch deal activities' });
  }
};

interface StageBody {
  name?: string;
  position?: number;
  is_won?: boolean;
  is_lost?: boolean;
}

export const createPipelineStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const pipeline = await getDefaultPipeline(organizationId);
    if (!pipeline) {
      res.status(404).json({ message: 'No pipeline found' });
      return;
    }

    const body = req.body as StageBody;
    const name = normalizeName(body.name);
    if (!name) {
      res.status(400).json({ message: 'name is required' });
      return;
    }

    const position = body.position ?? ((await PipelineStage.countDocuments({
      pipeline_id: pipeline._id,
      organization_id: organizationId
    })) + 1);

    const stage = await PipelineStage.create({
      name,
      pipeline_id: pipeline._id,
      order: position,
      is_won: body.is_won || false,
      is_lost: body.is_lost || false,
      organization_id: organizationId,
      assignees: []
    });

    res.status(201).json(formatStage(stage));
  } catch (error) {
    res.status(500).json({ message: 'Failed to create pipeline stage' });
  }
};

export const updatePipelineStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId } = req.params as { stageId: string };
    if (!isValidObjectId(stageId)) {
      res.status(400).json({ message: 'Invalid stage ID' });
      return;
    }

    const body = req.body as StageBody;
    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = normalizeName(body.name);
      if (!name) {
        res.status(400).json({ message: 'name cannot be empty' });
        return;
      }
      update.name = name;
    }

    if (body.position !== undefined) update.order = body.position;
    if (body.is_won !== undefined) update.is_won = body.is_won;
    if (body.is_lost !== undefined) update.is_lost = body.is_lost;

    const stage = await PipelineStage.findOneAndUpdate(
      { _id: stageId, organization_id: organizationId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!stage) {
      res.status(404).json({ message: 'Stage not found' });
      return;
    }

    res.json(formatStage(stage));
  } catch (error) {
    res.status(500).json({ message: 'Failed to update pipeline stage' });
  }
};

export const deletePipelineStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { stageId } = req.params as { stageId: string };
    if (!isValidObjectId(stageId)) {
      res.status(400).json({ message: 'Invalid stage ID' });
      return;
    }

    const dealsInStage = await Deal.countDocuments({ stage_id: stageId, organization_id: organizationId });
    if (dealsInStage > 0) {
      res.status(400).json({ message: 'Cannot delete stage with deals. Move or delete deals first.' });
      return;
    }

    const stage = await PipelineStage.findOneAndDelete({ _id: stageId, organization_id: organizationId });
    if (!stage) {
      res.status(404).json({ message: 'Stage not found' });
      return;
    }

    res.json({ message: 'Stage deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete pipeline stage' });
  }
};
