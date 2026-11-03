import { Response } from 'express';
import { Activity } from '../models/Activity';
import { Company } from '../models/Company';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { PipelineStage } from '../models/Pipeline';
import { Task } from '../models/Task';
import { AuthRequest } from '../types';
import { requireOrganization } from '../utils/tenant';
import { handleError } from '../utils/errorHandler';

type DateRange = {
  from?: Date;
  to?: Date;
};

const parseDateRange = (req: AuthRequest): DateRange => {
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;

  const from = fromRaw ? new Date(fromRaw) : undefined;
  const to = toRaw ? new Date(toRaw) : undefined;

  if (to && !Number.isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
  }

  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined
  };
};

const dateFilter = (field: string, range: DateRange): Record<string, unknown> => {
  const filter: Record<string, Date> = {};
  if (range.from) filter.$gte = range.from;
  if (range.to) filter.$lte = range.to;

  return Object.keys(filter).length > 0 ? { [field]: filter } : {};
};

const dateFormatForGroup = (groupBy?: string): string => {
  if (groupBy === 'month') return '%Y-%m';
  if (groupBy === 'week') return '%G-W%V';
  return '%Y-%m-%d';
};

const dashboardTrendRange = (range: DateRange): Required<DateRange> => {
  const to = range.to || new Date();
  const from = range.from || new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

  return { from, to };
};

const previousRange = (range: Required<DateRange>): Required<DateRange> => {
  const duration = range.to.getTime() - range.from.getTime();
  const previousTo = new Date(range.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration);

  return { from: previousFrom, to: previousTo };
};

const progressMetric = (current: number, previous: number) => ({
  current,
  previous,
  change: current - previous,
  percent_change: previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : 0
});

const escapeCSV = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

export const getDashboardSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const trendRange = dashboardTrendRange(range);
    const previousTrendRange = previousRange(trendRange);
    const orgQuery = { organization_id: organizationId };
    const periodQuery = { ...orgQuery, ...dateFilter('created_at', range) };
    const trendQuery = { ...orgQuery, ...dateFilter('created_at', trendRange) };
    const previousTrendQuery = { ...orgQuery, ...dateFilter('created_at', previousTrendRange) };
    const now = new Date();
    const nextSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalContacts,
      totalCompanies,
      totalDeals,
      totalTasks,
      newContacts,
      newCompanies,
      newDeals,
      newTasks,
      dealStatus,
      taskStatus,
      overdueTasks,
      dueSoonTasks,
      recentActivities,
      pipelineStages,
      pipelineStageDeals,
      recentContacts,
      dealSources,
      previousContacts,
      previousCompanies,
      previousOpenDeals,
      previousRevenueForecast,
      contactsTrend,
      companiesTrend,
      dealsTrend,
      tasksTrend
    ] = await Promise.all([
      Contact.countDocuments(orgQuery),
      Company.countDocuments(orgQuery),
      Deal.countDocuments(orgQuery),
      Task.countDocuments(orgQuery),
      Contact.countDocuments(periodQuery),
      Company.countDocuments(periodQuery),
      Deal.countDocuments(periodQuery),
      Task.countDocuments(periodQuery),
      Deal.aggregate([
        { $match: orgQuery },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } }
      ]),
      Task.aggregate([
        { $match: orgQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Task.countDocuments({
        ...orgQuery,
        status: { $ne: 'completed' },
        due_at: { $lt: now }
      }),
      Task.countDocuments({
        ...orgQuery,
        status: { $ne: 'completed' },
        due_at: { $gte: now, $lte: nextSevenDays }
      }),
      Activity.find(orgQuery)
        .populate('user_id', 'email display_name')
        .sort({ created_at: -1 })
        .limit(10)
        .lean(),
      PipelineStage.find(orgQuery)
        .sort({ order: 1 })
        .select('_id name order is_won is_lost')
        .lean(),
      Deal.aggregate([
        { $match: { ...orgQuery, status: 'open' } },
        { $group: { _id: '$stage_id', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } }
      ]),
      Contact.find(orgQuery)
        .populate('company_id', 'name')
        .sort({ created_at: -1 })
        .limit(5)
        .select('first_name last_name role_title temperature company_id created_at')
        .lean(),
      Deal.aggregate([
        { $match: orgQuery },
        { $group: { _id: { $ifNull: ['$source', 'Unknown'] }, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
        { $sort: { count: -1 } }
      ]),
      Contact.countDocuments(previousTrendQuery),
      Company.countDocuments(previousTrendQuery),
      Deal.countDocuments({ ...previousTrendQuery, status: 'open' }),
      Deal.aggregate([
        { $match: { ...previousTrendQuery, status: 'open' } },
        { $group: { _id: null, value: { $sum: { $ifNull: ['$value', 0] } } } }
      ]),
      Contact.aggregate([
        { $match: trendQuery },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, value: { $sum: 1 } } },
        { $project: { date: '$_id', value: 1, _id: 0 } },
        { $sort: { date: 1 } }
      ]),
      Company.aggregate([
        { $match: trendQuery },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, value: { $sum: 1 } } },
        { $project: { date: '$_id', value: 1, _id: 0 } },
        { $sort: { date: 1 } }
      ]),
      Deal.aggregate([
        { $match: trendQuery },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            open_deals: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
            revenue_forecast: {
              $sum: { $cond: [{ $eq: ['$status', 'open'] }, { $ifNull: ['$value', 0] }, 0] }
            },
            total_deals: { $sum: 1 },
            total_value: { $sum: { $ifNull: ['$value', 0] } }
          }
        },
        { $project: { date: '$_id', open_deals: 1, revenue_forecast: 1, total_deals: 1, total_value: 1, _id: 0 } },
        { $sort: { date: 1 } }
      ]),
      Task.aggregate([
        { $match: trendQuery },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, value: { $sum: 1 } } },
        { $project: { date: '$_id', value: 1, _id: 0 } },
        { $sort: { date: 1 } }
      ])
    ]);

    const openDeals = dealStatus.find((item) => item._id === 'open');
    const wonDeals = dealStatus.find((item) => item._id === 'won');
    const lostDeals = dealStatus.find((item) => item._id === 'lost');
    const closedDeals = (wonDeals?.count || 0) + (lostDeals?.count || 0);
    const stageStats = new Map(
      pipelineStageDeals.map((item) => [String(item._id), { count: item.count, value: item.value }])
    );
    const pipelineReview = pipelineStages.map((stage) => {
      const stats = stageStats.get(String(stage._id)) || { count: 0, value: 0 };
      return {
        stage_id: stage._id,
        name: stage.name,
        order: stage.order,
        count: stats.count,
        value: stats.value,
        is_won: stage.is_won,
        is_lost: stage.is_lost
      };
    });
    const pipelineTotal = pipelineReview.reduce(
      (total, stage) => ({
        count: total.count + stage.count,
        value: total.value + stage.value
      }),
      { count: 0, value: 0 }
    );
    const previousRevenueForecastValue = previousRevenueForecast[0]?.value || 0;
    const currentContactsTrend = contactsTrend.reduce((total, item) => total + item.value, 0);
    const currentCompaniesTrend = companiesTrend.reduce((total, item) => total + item.value, 0);
    const currentOpenDealsTrend = dealsTrend.reduce((total, item) => total + item.open_deals, 0);
    const currentRevenueForecastTrend = dealsTrend.reduce((total, item) => total + item.revenue_forecast, 0);
    const cardProgress = {
      open_deals: progressMetric(currentOpenDealsTrend, previousOpenDeals),
      revenue_forecast: progressMetric(currentRevenueForecastTrend, previousRevenueForecastValue),
      active_contacts: progressMetric(currentContactsTrend, previousContacts),
      active_companies: progressMetric(currentCompaniesTrend, previousCompanies)
    };

    res.json({
      status: true,
      message: 'Dashboard summary retrieved successfully',
      data: {
        cards: {
          open_deals: openDeals?.count || 0,
          revenue_forecast: openDeals?.value || 0,
          active_contacts: totalContacts,
          active_companies: totalCompanies
        },
        card_progress: cardProgress,
        charts: {
          from: trendRange.from,
          to: trendRange.to,
          contacts: contactsTrend,
          companies: companiesTrend,
          deals: dealsTrend,
          tasks: tasksTrend
        },
        pipeline_review: pipelineReview,
        pipeline_total: {
          count: pipelineTotal.count,
          value: pipelineTotal.value
        },
        recent_contacts: recentContacts.map((contact) => ({
          id: contact._id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          full_name: `${contact.first_name} ${contact.last_name}`.trim(),
          role_title: contact.role_title,
          temperature: contact.temperature,
          company: (contact.company_id as unknown as { name?: string })?.name,
          created_at: contact.created_at
        })),
        deal_sources: dealSources.map((source) => ({
          source: source._id,
          count: source.count,
          value: source.value
        })),
        totals: {
          contacts: totalContacts,
          companies: totalCompanies,
          deals: totalDeals,
          tasks: totalTasks
        },
        period: {
          from: range.from,
          to: range.to,
          contacts: newContacts,
          companies: newCompanies,
          deals: newDeals,
          tasks: newTasks
        },
        pipeline: {
          open_deals: openDeals?.count || 0,
          open_value: openDeals?.value || 0,
          won_deals: wonDeals?.count || 0,
          won_value: wonDeals?.value || 0,
          lost_deals: lostDeals?.count || 0,
          lost_value: lostDeals?.value || 0,
          total_deals: pipelineTotal.count,
          total_value: pipelineTotal.value,
          win_rate: closedDeals > 0 ? Math.round(((wonDeals?.count || 0) / closedDeals) * 100) : 0
        },
        tasks: {
          by_status: taskStatus,
          overdue: overdueTasks,
          due_next_7_days: dueSoonTasks
        },
        recent_activities: recentActivities
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch dashboard summary');
  }
};

export const getSalesReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const groupBy = req.query.group_by as string | undefined;
    const orgMatch = { organization_id: organizationId };
    const periodMatch = { ...orgMatch, ...dateFilter('created_at', range) };
    const wonPeriodMatch = { ...orgMatch, status: 'won', ...dateFilter('updated_at', range) };
    const dateFormat = dateFormatForGroup(groupBy);

    const [byStatus, byStage, trend, byOwner, bySource, byIndustry] = await Promise.all([
      Deal.aggregate([
        { $match: periodMatch },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
        { $sort: { _id: 1 } }
      ]),
      Deal.aggregate([
        { $match: orgMatch },
        { $group: { _id: '$stage_id', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
        { $lookup: { from: 'pipelinestages', localField: '_id', foreignField: '_id', as: 'stage' } },
        { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
        { $project: { stage_id: '$_id', stage_name: '$stage.name', order: '$stage.order', count: 1, value: 1, _id: 0 } },
        { $sort: { order: 1 } }
      ]),
      Deal.aggregate([
        { $match: wonPeriodMatch },
        {
          $group: {
            _id: { $dateToString: { format: dateFormat, date: '$updated_at' } },
            won_value: { $sum: { $ifNull: ['$value', 0] } },
            won_count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      Deal.aggregate([
        { $match: periodMatch },
        { $group: { _id: '$owner_id', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } }, won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'owner' } },
        { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
        { $project: { owner_id: '$_id', owner_name: '$owner.display_name', owner_email: '$owner.email', count: 1, value: 1, won: 1, _id: 0 } },
        { $sort: { value: -1 } }
      ]),
      Deal.aggregate([
        { $match: periodMatch },
        { $group: { _id: { $ifNull: ['$source', 'Unknown'] }, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
        { $sort: { value: -1 } }
      ]),
      Deal.aggregate([
        { $match: periodMatch },
        { $group: { _id: { $ifNull: ['$industry', 'Unknown'] }, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
        { $sort: { value: -1 } }
      ])
    ]);

    res.json({
      status: true,
      message: 'Sales report retrieved successfully',
      data: {
        from: range.from,
        to: range.to,
        group_by: groupBy || 'day',
        by_status: byStatus,
        by_stage: byStage,
        won_revenue_trend: trend,
        by_owner: byOwner,
        by_source: bySource,
        by_industry: byIndustry
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch sales report');
  }
};

export const getTaskReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const match = { organization_id: organizationId, ...dateFilter('created_at', range) };
    const now = new Date();

    const [byStatus, byPriority, byType, byOwner, overdue] = await Promise.all([
      Task.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Task.aggregate([{ $match: match }, { $group: { _id: '$priority', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Task.aggregate([{ $match: match }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Task.aggregate([
        { $match: match },
        { $group: { _id: '$owner_id', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'owner' } },
        { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
        { $project: { owner_id: '$_id', owner_name: '$owner.display_name', owner_email: '$owner.email', total: 1, completed: 1, _id: 0 } },
        { $sort: { total: -1 } }
      ]),
      Task.countDocuments({ organization_id: organizationId, status: { $ne: 'completed' }, due_at: { $lt: now } })
    ]);

    res.json({
      status: true,
      message: 'Task report retrieved successfully',
      data: {
        from: range.from,
        to: range.to,
        by_status: byStatus,
        by_priority: byPriority,
        by_type: byType,
        by_owner: byOwner,
        overdue
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch task report');
  }
};

export const getActivityReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const range = parseDateRange(req);
    const groupBy = req.query.group_by as string | undefined;
    const match = { organization_id: organizationId, ...dateFilter('created_at', range) };
    const dateFormat = dateFormatForGroup(groupBy);

    const [byType, byUser, trend] = await Promise.all([
      Activity.aggregate([{ $match: match }, { $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Activity.aggregate([
        { $match: match },
        { $group: { _id: '$user_id', count: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { user_id: '$_id', user_name: '$user.display_name', user_email: '$user.email', count: 1, _id: 0 } },
        { $sort: { count: -1 } }
      ]),
      Activity.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: dateFormat, date: '$created_at' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ])
    ]);

    res.json({
      status: true,
      message: 'Activity report retrieved successfully',
      data: {
        from: range.from,
        to: range.to,
        group_by: groupBy || 'day',
        by_type: byType,
        by_user: byUser,
        trend
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch activity report');
  }
};

export const exportDashboardReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const reportType = String(req.query.type || 'sales');
    const range = parseDateRange(req);
    const match = { organization_id: organizationId, ...dateFilter('created_at', range) };

    if (reportType === 'tasks') {
      const tasks = await Task.find(match)
        .populate('owner_id', 'email display_name')
        .sort({ created_at: -1 })
        .lean();

      const headers = ['title', 'type', 'priority', 'status', 'owner_email', 'due_at', 'created_at'];
      const rows = tasks.map((task) => [
        escapeCSV(task.title),
        escapeCSV(task.type),
        escapeCSV(task.priority),
        escapeCSV(task.status),
        escapeCSV((task.owner_id as unknown as { email?: string })?.email),
        escapeCSV(task.due_at),
        escapeCSV(task.created_at)
      ].join(','));

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="task-report.csv"');
      res.send([headers.join(','), ...rows].join('\n'));
      return;
    }

    const deals = await Deal.find(match)
      .populate('owner_id', 'email display_name')
      .populate('company_id', 'name')
      .populate('stage_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    const headers = ['title', 'status', 'value', 'currency', 'stage', 'company', 'owner_email', 'source', 'industry', 'created_at'];
    const rows = deals.map((deal) => [
      escapeCSV(deal.title),
      escapeCSV(deal.status),
      escapeCSV(deal.value),
      escapeCSV(deal.currency),
      escapeCSV((deal.stage_id as unknown as { name?: string })?.name),
      escapeCSV((deal.company_id as unknown as { name?: string })?.name),
      escapeCSV((deal.owner_id as unknown as { email?: string })?.email),
      escapeCSV(deal.source),
      escapeCSV(deal.industry),
      escapeCSV(deal.created_at)
    ].join(','));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
    res.send([headers.join(','), ...rows].join('\n'));
  } catch (error) {
    handleError(res, error, 'Failed to export report');
  }
};
