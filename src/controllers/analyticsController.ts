import { Response } from 'express';
import mongoose from 'mongoose';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { Organization } from '../models/Organization';
import { PipelineStage } from '../models/Pipeline';
import { Task } from '../models/Task';
import { User } from '../models/User';
import { AuthRequest } from '../types';
import { requireOrganization } from '../utils/tenant';
import { generateAnalyticsBreakdown } from '../utils/groq';

type DateRange = {
  from?: Date;
  to?: Date;
};

type StageMapValue = {
  name: string;
  is_won: boolean;
  is_lost: boolean;
};

type Timeframe = 'daily' | 'weekly' | 'monthly';

const getTimeframeFrom = (timeframe: Timeframe): Date => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (timeframe === 'daily') return startOfDay;

  if (timeframe === 'weekly') {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    return new Date(startOfDay.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const isTimeframe = (value: string | undefined): value is Timeframe =>
  value === 'daily' || value === 'weekly' || value === 'monthly';

const parseDateRange = (req: AuthRequest): DateRange => {
  let range: DateRange = {};

  if (isTimeframe(req.query.timeframe as string)) {
    range = { from: getTimeframeFrom(req.query.timeframe as Timeframe), to: new Date() };
  }

  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;

  if (fromRaw) {
    const from = new Date(fromRaw);
    if (!Number.isNaN(from.getTime())) range.from = from;
  }

  if (toRaw) {
    const to = new Date(toRaw);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      range.to = to;
    }
  }

  return range;
};

const dateFilter = (field: string, range: DateRange): Record<string, unknown> => {
  const filter: Record<string, Date> = {};
  if (range.from) filter.$gte = range.from;
  if (range.to) filter.$lte = range.to;
  return Object.keys(filter).length > 0 ? { [field]: filter } : {};
};

const percent = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 10000) / 100 : 0);

const getStageMap = async (organizationId: mongoose.Types.ObjectId) => {
  const stages = await PipelineStage.find({ organization_id: organizationId })
    .select('_id name is_won is_lost order')
    .sort({ order: 1 })
    .lean();

  return new Map<string, StageMapValue>(
    stages.map((stage) => [
      String(stage._id),
      {
        name: stage.name,
        is_won: stage.is_won,
        is_lost: stage.is_lost
      }
    ])
  );
};

const getSummary = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const stageMap = await getStageMap(organizationId);
  const dealQuery = { organization_id: organizationId, ...dateFilter('created_at', range) };
  const taskQuery = { organization_id: organizationId, ...dateFilter('created_at', range) };
  const contactQuery = { organization_id: organizationId, ...dateFilter('created_at', range) };
  const now = new Date();
  const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [deals, totalLeads, convertedLeadIds, tasksCompletedLast30Days] = await Promise.all([
    Deal.find(dealQuery).select('value stage_id created_at stage_changed_at contact_id source').lean(),
    Contact.countDocuments(contactQuery),
    Deal.distinct('contact_id', {
      organization_id: organizationId,
      contact_id: { $ne: null },
      ...dateFilter('created_at', range)
    }),
    Task.countDocuments({
      ...taskQuery,
      status: 'completed',
      updated_at: { $gte: lastThirtyDays, $lte: now }
    })
  ]);

  let wonRevenue = 0;
  let pipelineValue = 0;
  let wonDeals = 0;
  let lostDeals = 0;
  let totalCycleDays = 0;
  let cycleCount = 0;

  for (const deal of deals) {
    const stage = deal.stage_id ? stageMap.get(String(deal.stage_id)) : undefined;
    const value = deal.value || 0;

    if (stage?.is_won) {
      wonRevenue += value;
      wonDeals += 1;

      const endDate = deal.stage_changed_at || deal.created_at;
      if (deal.created_at && endDate) {
        totalCycleDays += Math.max(0, endDate.getTime() - deal.created_at.getTime()) / (24 * 60 * 60 * 1000);
        cycleCount += 1;
      }
    } else if (stage?.is_lost) {
      lostDeals += 1;
    } else {
      pipelineValue += value;
    }
  }

  return {
    won_revenue: wonRevenue,
    pipeline_value: pipelineValue,
    win_rate: percent(wonDeals, wonDeals + lostDeals),
    average_cycle_days: cycleCount > 0 ? Math.round((totalCycleDays / cycleCount) * 100) / 100 : 0,
    lead_conversion_rate: percent(convertedLeadIds.length, totalLeads),
    tasks_completed_last_30_days: tasksCompletedLast30Days
  };
};

const getPipelineByStage = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const stages = await PipelineStage.find({ organization_id: organizationId })
    .select('_id name order')
    .sort({ order: 1 })
    .lean();

  const stats = await Deal.aggregate([
    { $match: { organization_id: organizationId, ...dateFilter('created_at', range) } },
    { $group: { _id: '$stage_id', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } }
  ]);

  const statMap = new Map(stats.map((item) => [String(item._id), item]));

  return stages.map((stage) => {
    const stat = statMap.get(String(stage._id));
    return {
      stage_id: stage._id,
      name: stage.name,
      count: stat?.count || 0,
      value: stat?.value || 0
    };
  });
};

const getLeadSources = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const sources = await Deal.aggregate([
    { $match: { organization_id: organizationId, ...dateFilter('created_at', range) } },
    {
      $group: {
        _id: {
          $cond: [
            { $or: [{ $eq: ['$source', null] }, { $eq: ['$source', ''] }] },
            'Direct',
            '$source'
          ]
        },
        value: { $sum: 1 }
      }
    },
    { $project: { name: '$_id', value: 1, _id: 0 } },
    { $sort: { value: -1, name: 1 } }
  ]);

  return sources;
};

const getTaskSummary = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const now = new Date();
  const tasks = await Task.find({ organization_id: organizationId, ...dateFilter('created_at', range) })
    .select('status due_at')
    .lean();

  const assigned = tasks.length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const open = tasks.filter((task) => task.status !== 'completed').length;
  const overdue = tasks.filter((task) => task.status !== 'completed' && task.due_at && task.due_at < now).length;

  return {
    assigned,
    completed,
    open,
    overdue,
    completion_rate: percent(completed, assigned)
  };
};

const getTeamProductivity = async (organizationId: mongoose.Types.ObjectId, range: DateRange) => {
  const now = new Date();
  const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [tasks, users] = await Promise.all([
    Task.find({ organization_id: organizationId, ...dateFilter('created_at', range) })
      .select('status due_at assignees owner_id updated_at')
      .lean(),
    User.find({ organization_id: organizationId, is_active: true })
      .select('display_name email')
      .lean()
  ]);

  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const stats = new Map<string, {
    user_id: string | null;
    name: string;
    assigned: number;
    completed: number;
    open: number;
    overdue: number;
    recent_completed: number;
  }>();

  const ensureStat = (userId: string | null) => {
    const key = userId || 'unassigned';
    if (!stats.has(key)) {
      const user = userId ? userMap.get(userId) : undefined;
      stats.set(key, {
        user_id: userId,
        name: user?.display_name || user?.email || 'Unassigned',
        assigned: 0,
        completed: 0,
        open: 0,
        overdue: 0,
        recent_completed: 0
      });
    }
    return stats.get(key)!;
  };

  for (const task of tasks) {
    const assigneeIds = task.assignees?.length
      ? task.assignees.map((id) => String(id))
      : task.owner_id
        ? [String(task.owner_id)]
        : [null];

    for (const userId of assigneeIds) {
      const stat = ensureStat(userId);
      stat.assigned += 1;
      if (task.status === 'completed') {
        stat.completed += 1;
        if (task.updated_at && task.updated_at >= lastThirtyDays) {
          stat.recent_completed += 1;
        }
      } else {
        stat.open += 1;
        if (task.due_at && task.due_at < now) {
          stat.overdue += 1;
        }
      }
    }
  }

  return Array.from(stats.values()).map((stat) => ({
    ...stat,
    completion_rate: percent(stat.completed, stat.assigned)
  }));
};

export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const [summary, pipelineByStage, leadSources, teamProductivity, taskSummary] = await Promise.all([
      getSummary(organizationId, range),
      getPipelineByStage(organizationId, range),
      getLeadSources(organizationId, range),
      getTeamProductivity(organizationId, range),
      getTaskSummary(organizationId, range)
    ]);

    res.json({
      status: true,
      message: 'Analytics retrieved successfully',
      data: {
      summary,
      pipeline_by_stage: pipelineByStage,
      lead_sources: leadSources,
      team_productivity: teamProductivity,
      task_summary: taskSummary
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch analytics' });
  }
};

export const getAnalyticsSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Analytics summary retrieved successfully',
      data: await getSummary(organizationId, parseDateRange(req))
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch analytics summary' });
  }
};

export const getAnalyticsPipelineByStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Pipeline analytics retrieved successfully',
      data: await getPipelineByStage(organizationId, parseDateRange(req))
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch pipeline analytics' });
  }
};

export const getAnalyticsLeadSources = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Lead sources retrieved successfully',
      data: await getLeadSources(organizationId, parseDateRange(req))
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch lead sources' });
  }
};

export const getAnalyticsTeamProductivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Team productivity retrieved successfully',
      data: await getTeamProductivity(organizationId, parseDateRange(req))
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch team productivity' });
  }
};

export const getAnalyticsTaskSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Task summary retrieved successfully',
      data: await getTaskSummary(organizationId, parseDateRange(req))
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch task summary' });
  }
};

const formatDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const describeDateRange = (range: DateRange): string => {
  if (range.from && range.to) return `${formatDateOnly(range.from)} to ${formatDateOnly(range.to)}`;
  if (range.from) return `from ${formatDateOnly(range.from)}`;
  if (range.to) return `up to ${formatDateOnly(range.to)}`;
  return 'all time';
};

export const getAnalyticsAiBreakdown = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const [summary, pipelineByStage, leadSources, teamProductivity, taskSummary, organization] = await Promise.all([
      getSummary(organizationId, range),
      getPipelineByStage(organizationId, range),
      getLeadSources(organizationId, range),
      getTeamProductivity(organizationId, range),
      getTaskSummary(organizationId, range),
      Organization.findById(organizationId).select('name').lean()
    ]);

    const breakdown = await generateAnalyticsBreakdown({
      organization_name: organization?.name,
      range_label: describeDateRange(range),
      analytics: {
        summary,
        pipeline_by_stage: pipelineByStage,
        lead_sources: leadSources,
        team_productivity: teamProductivity,
        task_summary: taskSummary
      }
    });

    res.json({
      status: true,
      message: 'AI analytics breakdown generated successfully',
      data: {
        breakdown,
        period: describeDateRange(range),
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('AI analytics breakdown error:', error);
    res.status(500).json({ status: false, message: 'Failed to generate AI analytics breakdown' });
  }
};
