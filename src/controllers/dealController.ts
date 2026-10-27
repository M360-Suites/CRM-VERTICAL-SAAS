import { Response } from 'express';
import mongoose from 'mongoose';
import { Deal, IDeal, DealStatus } from '../models/Deal';
import { Company } from '../models/Company';
import { Contact } from '../models/Contact';
import { Activity } from '../models/Activity';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { AuthRequest, PaginatedResponse } from '../types';
import { requireOrganization } from '../utils/tenant';
import { MAX_IMPORT_ROWS, nameKey, parseImportCsv } from '../utils/csvImport';
import { parseLeadValue } from '../utils/leadValue';
import { emitDealStageChanged } from '../services/socketService';
import { queueDealTriggers } from '../services/triggerService';
import { assignDealOwner } from '../services/dealAssignmentService';

interface DealQuery {
  page?: number;
  limit?: number;
  search?: string;
  company_id?: string;
  owner_id?: string;
  stage_id?: string;
  status?: DealStatus;
}

const canUpdateDeal = (req: AuthRequest, deal: { owner_id?: unknown }): boolean => {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'sales_manager') return true;
  return req.user.role === 'sales_rep' && deal.owner_id?.toString() === req.user.id;
};

const validateOptionalObjectId = (value: string | undefined, label: string): string | undefined => {
  if (!value) return undefined;
  return mongoose.Types.ObjectId.isValid(value) ? undefined : `Invalid ${label}`;
};

export const listDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      company_id,
      owner_id,
      stage_id,
      status
    } = req.query as DealQuery;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const query: Record<string, unknown> = { organization_id: organizationId };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { source: { $regex: search, $options: 'i' } },
        { industry: { $regex: search, $options: 'i' } }
      ];
    }

    if (company_id) query.company_id = new mongoose.Types.ObjectId(company_id);
    if (owner_id === 'unassigned') query.owner_id = null;
    else if (owner_id) query.owner_id = new mongoose.Types.ObjectId(owner_id);
    if (stage_id) query.stage_id = new mongoose.Types.ObjectId(stage_id);
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const [deals, total] = await Promise.all([
      Deal.find(query)
        .populate('stage_id', 'name order is_won is_lost')
        .populate('company_id', 'name industry website')
        .populate('contact_id', 'first_name last_name email')
        .populate('owner_id', 'email display_name')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Deal.countDocuments(query)
    ]);

    const response: PaginatedResponse<IDeal> = {
      status: true,
      message: 'Deals retrieved successfully',
      data: {
        data: deals,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch deals'
    });
  }
};

export const getAllDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deals = await Deal.find({ organization_id: organizationId })
      .populate('stage_id', 'name order is_won is_lost')
      .populate('company_id', 'name industry website')
      .populate('contact_id', 'first_name last_name email')
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'All deals retrieved successfully',
      data: deals
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch all deals'
    });
  }
};

export const getDealById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deal = await Deal.findOne({ _id: id, organization_id: organizationId })
      .populate('stage_id', 'name order is_won is_lost')
      .populate('company_id', 'name industry website')
      .populate('contact_id', 'first_name last_name email phone')
      .populate('owner_id', 'email display_name')
      .lean();

    if (!deal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    res.json({ status: true, message: 'Deal retrieved successfully', data: deal });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch deal'
    });
  }
};

interface CreateDealBody {
  title: string;
  value?: number;
  currency?: string;
  expected_close_date?: string;
  stage_id?: string;
  source?: string;
  industry?: string;
  company_id?: string;
  contact_id?: string;
}

export const createDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      value,
      currency,
      expected_close_date,
      stage_id,
      source,
      industry,
      company_id,
      contact_id
    } = req.body as CreateDealBody;

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const invalidReference =
      validateOptionalObjectId(stage_id, 'stage ID') ||
      validateOptionalObjectId(company_id, 'company ID') ||
      validateOptionalObjectId(contact_id, 'contact ID');

    if (invalidReference) {
      res.status(400).json({
        status: false,
        message: invalidReference
      });
      return;
    }

    const [stageExists, companyExists, contactExists] = await Promise.all([
      stage_id ? PipelineStage.exists({ _id: stage_id, organization_id: organizationId }) : Promise.resolve(true),
      company_id ? Company.exists({ _id: company_id, organization_id: organizationId }) : Promise.resolve(true),
      contact_id ? Contact.exists({ _id: contact_id, organization_id: organizationId }) : Promise.resolve(true)
    ]);

    if (!stageExists) {
      res.status(404).json({
        status: false,
        message: 'Stage not found'
      });
      return;
    }

    if (!companyExists) {
      res.status(404).json({
        status: false,
        message: 'Company not found'
      });
      return;
    }

    if (!contactExists) {
      res.status(404).json({
        status: false,
        message: 'Contact not found'
      });
      return;
    }

    const deal = new Deal({
      title,
      value,
      currency,
      expected_close_date: expected_close_date ? new Date(expected_close_date) : undefined,
      stage_id: stage_id ? new mongoose.Types.ObjectId(stage_id) : undefined,
      stage_changed_at: stage_id ? new Date() : undefined,
      source,
      industry,
      company_id: company_id ? new mongoose.Types.ObjectId(company_id) : undefined,
      contact_id: contact_id ? new mongoose.Types.ObjectId(contact_id) : undefined,
      owner_id: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      organization_id: organizationId
    });

    await deal.save();
    void queueDealTriggers({ organizationId, dealId: deal._id, stageId: stage_id, isNew: true });

    const populatedDeal = await Deal.findOne({ _id: deal._id, organization_id: organizationId })
      .populate('stage_id', 'name order is_won is_lost')
      .populate('company_id', 'name industry website email phone')
      .populate('contact_id', 'first_name last_name email phone role_title')
      .populate('owner_id', 'email display_name');

    if (req.user?.id) {
      await Activity.create({
        type: 'deal_created',
        content: `Deal "${title}" created`,
        deal_id: deal._id,
        user_id: new mongoose.Types.ObjectId(req.user.id),
        organization_id: organizationId
      });
    }

    res.status(201).json({ status: true, message: 'Deal created successfully', data: populatedDeal });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to create deal'
    });
  }
};

interface UpdateDealBody {
  title?: string;
  value?: number;
  currency?: string;
  status?: DealStatus;
  expected_close_date?: string;
  stage_id?: string;
  source?: string;
  industry?: string;
  company_id?: string | null;
  contact_id?: string | null;
}

export const updateDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const updateData = req.body as UpdateDealBody;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const updateObj: Record<string, unknown> = { ...updateData };
    // Ownership changes go through PATCH /deals/:id/assign; tenancy never changes
    delete updateObj.owner_id;
    delete updateObj.organization_id;

    if ('value' in updateData && (updateData.value === null || updateData.value === undefined)) {
      updateObj.value = 0;
    }

    if (updateData.expected_close_date) {
      updateObj.expected_close_date = new Date(updateData.expected_close_date);
    }

    if (updateData.stage_id) {
      updateObj.stage_id = new mongoose.Types.ObjectId(updateData.stage_id);
    } else if (updateData.stage_id === null) {
      updateObj.stage_id = null;
    }

    if (updateData.company_id) {
      updateObj.company_id = new mongoose.Types.ObjectId(updateData.company_id);
    } else if (updateData.company_id === null) {
      updateObj.company_id = null;
    }

    if (updateData.contact_id) {
      updateObj.contact_id = new mongoose.Types.ObjectId(updateData.contact_id);
    } else if (updateData.contact_id === null) {
      updateObj.contact_id = null;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const existingDeal = await Deal.findOne({ _id: id, organization_id: organizationId }).select('owner_id stage_id').lean();
    if (!existingDeal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    if (!canUpdateDeal(req, existingDeal)) {
      res.status(403).json({
        status: false,
        message: "You don't have permission to update this deal"
      });
      return;
    }

    let stageChangeInfo: { stage_id: string; stage_name: string } | null = null;

    if (updateData.stage_id) {
      const targetStage = await PipelineStage.findOne({ _id: updateData.stage_id, organization_id: organizationId }).select('name is_won is_lost').lean();
      if (!targetStage) {
        res.status(404).json({
          status: false,
          message: 'Stage not found'
        });
        return;
      }

      if (existingDeal.stage_id) {
        const currentStage = await PipelineStage.findById(existingDeal.stage_id).select('is_won is_lost').lean();
        if (currentStage?.is_won) {
          res.status(400).json({ message: 'Cannot move a deal from a Won stage' });
          return;
        }
        if (currentStage?.is_lost) {
          res.status(400).json({ message: 'Cannot move a deal from a Lost stage' });
          return;
        }
      }

      updateObj.stage_changed_at = new Date();
      updateObj.stage_id = new mongoose.Types.ObjectId(updateData.stage_id);
      updateObj.status = targetStage.is_won ? 'won' : targetStage.is_lost ? 'lost' : 'open';
      stageChangeInfo = { stage_id: updateData.stage_id, stage_name: targetStage.name };
    }

    const deal = await Deal.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { $set: updateObj },
      { new: true, runValidators: true }
    )
      .populate('stage_id', 'name order is_won is_lost')
      .populate('company_id', 'name industry website')
      .populate('contact_id', 'first_name last_name')
      .populate('owner_id', 'email display_name');

    if (!deal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    if (req.user?.id && updateData.status) {
      await Activity.create({
        type: `deal_${updateData.status}`,
        content: `Deal status changed to ${updateData.status}`,
        deal_id: deal._id,
        user_id: new mongoose.Types.ObjectId(req.user.id),
        organization_id: organizationId
      });
    }

    if (req.user?.id && stageChangeInfo) {
      await Activity.create({
        type: 'stage_change',
        content: `Moved to ${stageChangeInfo.stage_name}`,
        deal_id: deal._id,
        user_id: new mongoose.Types.ObjectId(req.user.id),
        organization_id: organizationId,
        metadata: {
          stage_id: stageChangeInfo.stage_id,
          stage_name: stageChangeInfo.stage_name,
          stage_changed_at: updateObj.stage_changed_at
        }
      });

      emitDealStageChanged(organizationId.toString(), {
        deal_id: id,
        stage_id: stageChangeInfo.stage_id,
        title: deal.title,
        userId: req.user.id
      });
    }

    if (stageChangeInfo) {
      void queueDealTriggers({ organizationId, dealId: deal._id, stageId: stageChangeInfo.stage_id });
    }

    res.json({ status: true, message: 'Deal updated successfully', data: deal });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update deal'
    });
  }
};

export const deleteDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deal = await Deal.findOneAndDelete({ _id: id, organization_id: organizationId });

    if (!deal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    res.json({ status: true, message: 'Deal deleted successfully' });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to delete deal'
    });
  }
};

export const getDealActivities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const activities = await Activity.find({ deal_id: id, organization_id: organizationId })
      .populate('user_id', 'email display_name')
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    res.json({ status: true, message: 'Deal activities retrieved successfully', data: activities });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch activities'
    });
  }
};

export const getDealTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const { Task } = await import('../models/Task');
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const tasks = await Task.find({ deal_id: id, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .populate('assignees', 'email display_name')
      .populate('contact_id', 'first_name last_name')
      .sort({ due_at: 1 })
      .lean();

    res.json({ status: true, message: 'Deal tasks retrieved successfully', data: tasks });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch tasks'
    });
  }
};

export const getDealStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const deal = await Deal.findOne({ _id: id, organization_id: organizationId }).lean();
    if (!deal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    const { Task } = await import('../models/Task');
    const [taskCount, openTasks, activityCount] = await Promise.all([
      Task.countDocuments({ deal_id: id, organization_id: organizationId }),
      Task.countDocuments({ deal_id: id, organization_id: organizationId, status: { $ne: 'completed' } }),
      Activity.countDocuments({ deal_id: id, organization_id: organizationId })
    ]);

    res.json({
      status: true,
      message: 'Deal stats retrieved successfully',
      data: {
        value: deal.value ?? 0,
        currency: deal.currency || 'USD',
        status: deal.status,
        task_count: taskCount,
        open_tasks: openTasks,
        activity_count: activityCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to fetch deal stats'
    });
  }
};

export const updateDealStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { stage_id, stageId } = req.body as { stage_id?: string; stageId?: string };
    const targetStageId = stage_id || stageId;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid deal ID'
      });
      return;
    }

    if (!targetStageId || !mongoose.Types.ObjectId.isValid(targetStageId)) {
      res.status(400).json({
        status: false,
        message: 'Invalid stage ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const [existingDeal, targetStage] = await Promise.all([
      Deal.findOne({ _id: id, organization_id: organizationId }).select('owner_id stage_id').lean(),
      PipelineStage.findOne({ _id: targetStageId, organization_id: organizationId }).select('name is_won is_lost').lean()
    ]);

    if (!existingDeal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    if (!canUpdateDeal(req, existingDeal)) {
      res.status(403).json({
        status: false,
        message: "You don't have permission to update this deal"
      });
      return;
    }

    if (!targetStage) {
      res.status(404).json({
        status: false,
        message: 'Stage not found'
      });
      return;
    }

    if (existingDeal.stage_id) {
      const currentStage = await PipelineStage.findById(existingDeal.stage_id).select('is_won is_lost').lean();
      if (currentStage?.is_won) {
        res.status(400).json({ message: 'Cannot move a deal from a Won stage' });
        return;
      }
      if (currentStage?.is_lost) {
        res.status(400).json({ message: 'Cannot move a deal from a Lost stage' });
        return;
      }
    }

    const stageChangedAt = new Date();
    const status = targetStage.is_won ? 'won' : targetStage.is_lost ? 'lost' : 'open';
    const targetObjId = new mongoose.Types.ObjectId(targetStageId);

    if (req.user?.id) {
      await Activity.create({
        type: 'stage_change',
        content: `Moved to ${targetStage.name}`,
        deal_id: existingDeal._id,
        user_id: new mongoose.Types.ObjectId(req.user.id),
        organization_id: organizationId,
        metadata: {
          stage_id: targetStageId,
          stage_name: targetStage.name,
          stage_changed_at: stageChangedAt,
          status
        }
      });
    }

    const deal = await Deal.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      {
        $set: {
          stage_id: targetObjId,
          stage_changed_at: stageChangedAt,
          status
        }
      },
      { new: true }
    )
      .populate('stage_id', 'name order is_won is_lost')
      .populate('company_id', 'name industry website email phone')
      .populate('contact_id', 'first_name last_name email phone role_title')
      .populate('owner_id', 'email display_name');

    if (!deal) {
      res.status(404).json({
        status: false,
        message: 'Deal not found'
      });
      return;
    }

    if (req.user?.id) {
      emitDealStageChanged(organizationId.toString(), {
        deal_id: id,
        stage_id: targetStageId,
        title: deal.title,
        userId: req.user.id
      });
    }

    void queueDealTriggers({ organizationId, dealId: deal._id, stageId: targetStageId });

    res.json({ status: true, message: 'Deal stage updated successfully', data: deal });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update deal stage'
    });
  }
};

interface BulkUpdateStageBody {
  deal_ids: string[];
  stage_id: string;
}

export const bulkUpdateStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deal_ids, stage_id } = req.body as BulkUpdateStageBody;

    if (!Array.isArray(deal_ids) || deal_ids.length === 0) {
      res.status(400).json({
        status: false,
        message: 'deal_ids array is required'
      });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(stage_id)) {
      res.status(400).json({
        status: false,
        message: 'Invalid stage ID'
      });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const targetStage = await PipelineStage.findOne({ _id: stage_id, organization_id: organizationId }).select('name is_won is_lost').lean();
    if (!targetStage) {
      res.status(404).json({
        status: false,
        message: 'Stage not found'
      });
      return;
    }

    const validObjectIds: mongoose.Types.ObjectId[] = [];
    const invalidIds: string[] = [];

    for (const id of deal_ids) {
      if (mongoose.Types.ObjectId.isValid(id)) {
        validObjectIds.push(new mongoose.Types.ObjectId(id));
      } else {
        invalidIds.push(id);
      }
    }

    if (validObjectIds.length === 0) {
      res.status(400).json({
        status: false,
        message: 'No valid deal IDs provided'
      });
      return;
    }

    const stageChangedAt = new Date();
    const status = targetStage.is_won ? 'won' : targetStage.is_lost ? 'lost' : 'open';

    // Only deals actually changing stage should fire stage triggers
    const movingDeals = await Deal.find({
      _id: { $in: validObjectIds },
      organization_id: organizationId,
      stage_id: { $ne: new mongoose.Types.ObjectId(stage_id) }
    }).select('_id').lean();

    const result = await Deal.updateMany(
      { _id: { $in: validObjectIds }, organization_id: organizationId },
      { $set: { stage_id: new mongoose.Types.ObjectId(stage_id), stage_changed_at: stageChangedAt, status } }
    );

    if (req.user?.id) {
      await Activity.create({
        type: 'stage_change',
        content: `Bulk moved ${result.modifiedCount} deal(s) to ${targetStage.name}`,
        user_id: new mongoose.Types.ObjectId(req.user.id),
        organization_id: organizationId,
        metadata: {
          stage_id,
          stage_name: targetStage.name,
          deal_ids: validObjectIds.map(id => id.toString()),
          count: result.modifiedCount,
          stage_changed_at: stageChangedAt,
          status
        }
      });
    }

    if (req.user?.id) {
      emitDealStageChanged(organizationId.toString(), {
        deal_id: validObjectIds[0].toString(),
        stage_id,
        title: `bulk-${result.modifiedCount}`,
        userId: req.user.id
      });
    }

    for (const moved of movingDeals) {
      void queueDealTriggers({ organizationId, dealId: moved._id, stageId: stage_id });
    }

    res.json({
      status: true,
      message: invalidIds.length > 0
        ? `Deals stage updated. ${invalidIds.length} invalid ID(s) skipped.`
        : 'Deals stage updated successfully',
      data: { modified: result.modifiedCount, skipped_invalid: invalidIds.length > 0 ? invalidIds : undefined }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to update deals'
    });
  }
};

/**
 * Assign a deal to one person, or unassign it with owner_id: null.
 * Route is restricted to admins and sales managers.
 */
export const assignDeal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ status: false, message: 'Invalid deal ID' });
      return;
    }

    const body = (req.body ?? {}) as { owner_id?: unknown };
    if (!('owner_id' in body)) {
      res.status(400).json({ status: false, message: 'owner_id is required (use null to unassign)' });
      return;
    }
    const ownerId = body.owner_id;
    if (ownerId !== null && (typeof ownerId !== 'string' || !mongoose.Types.ObjectId.isValid(ownerId))) {
      res.status(400).json({ status: false, message: 'Invalid owner_id' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const result = await assignDealOwner({ organizationId, dealId: id, ownerId, actorId: req.user?.id });
    if (!result.ok) {
      res.status(result.status).json({ status: false, message: result.message });
      return;
    }

    res.json({
      status: true,
      message: result.deal.owner_id ? 'Deal assigned successfully' : 'Deal unassigned successfully',
      data: result.deal
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to assign deal' });
  }
};

/** CSV header (normalized) -> deal field. Unlisted columns become custom fields. */
const DEAL_CSV_FIELDS: Record<string, string> = {
  title: 'title',
  deal_title: 'title',
  deal_name: 'title',
  name: 'title',
  value: 'value',
  deal_value: 'value',
  amount: 'value',
  estimated_value: 'value',
  budget: 'value',
  currency: 'currency',
  status: 'status',
  stage: 'stage',
  stage_name: 'stage',
  stage_id: 'stage_id',
  pipeline: 'pipeline',
  pipeline_name: 'pipeline',
  pipeline_id: 'pipeline_id',
  expected_close_date: 'expected_close_date',
  close_date: 'expected_close_date',
  summary: 'summary',
  description: 'description',
  source: 'source',
  lead_source: 'source',
  industry: 'industry',
  company: 'company',
  company_name: 'company',
  company_id: 'company_id',
  contact_email: 'contact_email',
  email: 'contact_email',
  contact_id: 'contact_id'
};

const DEAL_STATUSES: DealStatus[] = ['open', 'won', 'lost'];

type ImportStage = {
  _id: mongoose.Types.ObjectId;
  name: string;
  pipeline_id: mongoose.Types.ObjectId;
  order: number;
  is_won: boolean;
  is_lost: boolean;
};

type ImportContact = { _id: mongoose.Types.ObjectId; email?: string; company_id?: mongoose.Types.ObjectId };

/**
 * Bulk import deals (pipeline leads) from CSV
 * `title` is required; `value` accepts formats like "5000", "$5,000" or "5k" and defaults to 0.
 * Stage is matched by `stage_id` or `stage` name (within `pipeline` / `pipeline_id`,
 * default pipeline otherwise) and falls back to that pipeline's first open stage.
 * Company and contact link by id, company name or contact email when they exist.
 * Every other column is stored in the deal's custom_fields.
 */
export const bulkImportDeals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    if (!req.file) {
      res.status(400).json({
        status: false,
        message: 'CSV file is required'
      });
      return;
    }

    const { rows, custom_columns } = parseImportCsv(req.file.buffer.toString('utf8'), DEAL_CSV_FIELDS);

    if (rows.length === 0) {
      res.status(400).json({
        status: false,
        message: 'CSV file must include a header row and at least one deal row'
      });
      return;
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      res.status(400).json({
        status: false,
        message: `CSV file can contain at most ${MAX_IMPORT_ROWS} deal rows`
      });
      return;
    }

    const distinct = (key: string) => [...new Set(rows.map(({ fields }) => fields[key]).filter(Boolean))];
    const validIds = (key: string) => distinct(key).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const caseInsensitive = { locale: 'en', strength: 2 };

    const companyIds = validIds('company_id');
    const companyNames = distinct('company');
    const contactIds = validIds('contact_id');
    const contactEmails = distinct('contact_email');

    // Resolve every reference up front instead of querying per row
    const [pipelines, stages, companiesById, companiesByName, contactsById, contactsByEmail] = await Promise.all([
      Pipeline.find({ organization_id: organizationId }).select('_id name is_default').sort({ created_at: 1 }).lean(),
      PipelineStage.find({ organization_id: organizationId })
        .select('_id name pipeline_id order is_won is_lost')
        .sort({ order: 1 })
        .lean<ImportStage[]>(),
      companyIds.length
        ? Company.find({ _id: { $in: companyIds }, organization_id: organizationId }).select('_id').lean()
        : Promise.resolve([]),
      companyNames.length
        ? Company.find({ name: { $in: companyNames }, organization_id: organizationId })
            .collation(caseInsensitive)
            .select('_id name')
            .lean()
        : Promise.resolve([]),
      contactIds.length
        ? Contact.find({ _id: { $in: contactIds }, organization_id: organizationId }).select('_id company_id').lean<ImportContact[]>()
        : Promise.resolve([] as ImportContact[]),
      contactEmails.length
        ? Contact.find({ email: { $in: contactEmails }, organization_id: organizationId })
            .collation(caseInsensitive)
            .select('_id email company_id')
            .lean<ImportContact[]>()
        : Promise.resolve([] as ImportContact[])
    ]);

    const defaultPipeline = pipelines.find((pipeline) => pipeline.is_default) ?? pipelines[0];
    const pipelineById = new Map(pipelines.map((pipeline) => [pipeline._id.toString(), pipeline]));
    const pipelineByName = new Map(pipelines.map((pipeline) => [nameKey(pipeline.name), pipeline]));
    const stageById = new Map(stages.map((stage) => [stage._id.toString(), stage]));
    const stagesForPipeline = (pipelineId: mongoose.Types.ObjectId) =>
      stages.filter((stage) => stage.pipeline_id.toString() === pipelineId.toString());

    const knownCompanyIds = new Set(companiesById.map((company) => company._id.toString()));
    const companyIdByName = new Map(companiesByName.map((company) => [nameKey(company.name), company._id]));
    const contactById = new Map(contactsById.map((contact) => [contact._id.toString(), contact]));
    const contactByEmail = new Map(contactsByEmail.map((contact) => [nameKey(contact.email ?? ''), contact]));

    const ownerId = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined;
    const now = new Date();
    const errors: string[] = [];
    const validDeals: Record<string, unknown>[] = [];

    rows.forEach(({ fields, custom_fields }, i) => {
      const row = `Row ${i + 1}`;
      const extra: Record<string, unknown> = { ...custom_fields };

      if (!fields.title) {
        errors.push(`${row}: title is required`);
        return;
      }

      let value = 0;
      if (fields.value) {
        const parsed = parseLeadValue(fields.value);
        const isZero = /^[^\d]*0+(\.0+)?[^\d]*$/.test(fields.value);
        if (parsed === undefined && !isZero) {
          errors.push(`${row}: value is invalid`);
          return;
        }
        value = parsed ?? 0;
      }

      let expectedCloseDate: Date | undefined;
      if (fields.expected_close_date) {
        expectedCloseDate = new Date(fields.expected_close_date);
        if (Number.isNaN(expectedCloseDate.getTime())) {
          errors.push(`${row}: expected_close_date is invalid`);
          return;
        }
      }

      const status = fields.status ? (fields.status.toLowerCase() as DealStatus) : undefined;
      if (status && !DEAL_STATUSES.includes(status)) {
        errors.push(`${row}: status must be one of ${DEAL_STATUSES.join(', ')}`);
        return;
      }

      // Stage: explicit id > name within the chosen pipeline > first open stage of that pipeline
      let stage: ImportStage | undefined;
      if (fields.stage_id) {
        stage = stageById.get(fields.stage_id);
        if (!stage) {
          errors.push(`${row}: stage_id is invalid`);
          return;
        }
      } else {
        const pipelineRef = fields.pipeline_id || fields.pipeline;
        const pipeline = fields.pipeline_id
          ? pipelineById.get(fields.pipeline_id)
          : fields.pipeline
            ? pipelineByName.get(nameKey(fields.pipeline))
            : defaultPipeline;
        if (!pipeline && pipelineRef) {
          errors.push(`${row}: pipeline "${pipelineRef}" not found`);
          return;
        }
        const candidates = pipeline ? stagesForPipeline(pipeline._id) : [];
        if (fields.stage) {
          stage = candidates.find((candidate) => nameKey(candidate.name) === nameKey(fields.stage));
          if (!stage) {
            errors.push(`${row}: stage "${fields.stage}" not found${pipeline ? ` in pipeline "${pipeline.name}"` : ''}`);
            return;
          }
        } else {
          stage = candidates.find((candidate) => !candidate.is_won && !candidate.is_lost) ?? candidates[0];
        }
      }

      let companyId: mongoose.Types.ObjectId | undefined;
      if (fields.company_id) {
        if (!knownCompanyIds.has(fields.company_id)) {
          errors.push(`${row}: company_id is invalid`);
          return;
        }
        companyId = new mongoose.Types.ObjectId(fields.company_id);
      } else if (fields.company) {
        companyId = companyIdByName.get(nameKey(fields.company));
        // An unmatched company name is kept rather than dropped
        if (!companyId) extra.company = fields.company;
      }

      let contact: ImportContact | undefined;
      if (fields.contact_id) {
        contact = contactById.get(fields.contact_id);
        if (!contact) {
          errors.push(`${row}: contact_id is invalid`);
          return;
        }
      } else if (fields.contact_email) {
        contact = contactByEmail.get(nameKey(fields.contact_email));
        if (!contact) extra.contact_email = fields.contact_email;
      }

      validDeals.push({
        title: fields.title,
        value,
        currency: fields.currency ? fields.currency.toUpperCase() : undefined,
        // A won/lost stage decides the status; otherwise use the column, default open
        status: stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : status ?? 'open',
        expected_close_date: expectedCloseDate,
        stage_id: stage?._id,
        stage_changed_at: stage ? now : undefined,
        summary: fields.summary || undefined,
        description: fields.description || undefined,
        source: fields.source || 'csv_import',
        industry: fields.industry || undefined,
        company_id: companyId ?? contact?.company_id,
        contact_id: contact?._id,
        owner_id: ownerId,
        organization_id: organizationId,
        custom_fields: extra
      });
    });

    let imported = 0;
    if (validDeals.length > 0) {
      const created = await Deal.insertMany(validDeals);
      imported = created.length;

      if (ownerId) {
        await Activity.insertMany(
          created.map((deal) => ({
            type: 'deal_created',
            content: `Deal "${deal.title}" imported from CSV`,
            deal_id: deal._id,
            user_id: ownerId,
            organization_id: organizationId
          }))
        );
      }
    }

    res.json({
      status: true,
      message: 'Deals imported successfully',
      data: {
        imported,
        failed: errors.length,
        custom_columns,
        errors: errors.length > 0 ? errors : undefined
      }
    });
  } catch (error) {
    res.status(500).json({
      status: false,
      message: 'Failed to import deals'
    });
  }
};
