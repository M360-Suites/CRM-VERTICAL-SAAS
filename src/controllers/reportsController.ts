import { Response } from 'express';
import mongoose from 'mongoose';
import { Contact } from '../models/Contact';
import { Deal } from '../models/Deal';
import { PipelineStage } from '../models/Pipeline';
import { AuthRequest } from '../types';
import { requireOrganization } from '../utils/tenant';
import { handleError } from '../utils/errorHandler';

type DateRange = {
  from?: Date;
  to?: Date;
};

type StageMapValue = {
  name: string;
  is_won: boolean;
  is_lost: boolean;
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

const reportSummaryRange = (range: DateRange): Required<DateRange> => {
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

const compareMetric = (current: number, previous: number) => ({
  current,
  previous,
  percentage_change: previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : 0,
  direction: current >= previous ? 'up' : 'down'
});

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

const summarizeDeals = (deals: Array<{ value?: number; stage_id?: unknown }>, stageMap: Map<string, StageMapValue>) => {
  let openValue = 0;
  let wonValue = 0;
  let lostValue = 0;

  for (const deal of deals) {
    const stage = deal.stage_id ? stageMap.get(String(deal.stage_id)) : undefined;
    const value = deal.value || 0;

    if (stage?.is_won) {
      wonValue += value;
    } else if (stage?.is_lost) {
      lostValue += value;
    } else {
      openValue += value;
    }
  }

  return {
    total_deals: deals.length,
    open_value: openValue,
    won_value: wonValue,
    lost_value: lostValue
  };
};

const getSummary = async (organizationId: mongoose.Types.ObjectId, range: DateRange = {}) => {
  const currentRange = reportSummaryRange(range);
  const priorRange = previousRange(currentRange);
  const [stageMap, currentDeals, previousDeals] = await Promise.all([
    getStageMap(organizationId),
    Deal.find({ organization_id: organizationId, ...dateFilter('created_at', currentRange) }).select('value stage_id').lean(),
    Deal.find({ organization_id: organizationId, ...dateFilter('created_at', priorRange) }).select('value stage_id').lean()
  ]);

  const current = summarizeDeals(currentDeals, stageMap);
  const previous = summarizeDeals(previousDeals, stageMap);

  return {
    period: {
      from: currentRange.from,
      to: currentRange.to
    },
    previous_period: {
      from: priorRange.from,
      to: priorRange.to
    },
    total_deals: compareMetric(current.total_deals, previous.total_deals),
    open_value: compareMetric(current.open_value, previous.open_value),
    won_value: compareMetric(current.won_value, previous.won_value),
    lost_value: compareMetric(current.lost_value, previous.lost_value)
  };
};

const getPipelineByStage = async (organizationId: mongoose.Types.ObjectId) => {
  const rows = await Deal.aggregate([
    { $match: { organization_id: organizationId } },
    { $group: { _id: '$stage_id', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$value', 0] } } } },
    { $lookup: { from: 'pipelinestages', localField: '_id', foreignField: '_id', as: 'stage' } },
    { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name: { $ifNull: ['$stage.name', 'Unassigned'] },
        count: 1,
        value: 1,
        order: { $ifNull: ['$stage.order', 9999] },
        _id: 0
      }
    },
    { $sort: { order: 1, name: 1 } }
  ]);

  return rows.map(({ order, ...row }) => row);
};

const getDealSourceMix = async (organizationId: mongoose.Types.ObjectId) =>
  Deal.aggregate([
    { $match: { organization_id: organizationId } },
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

const getContactTemperature = async (organizationId: mongoose.Types.ObjectId) =>
  Contact.aggregate([
    { $match: { organization_id: organizationId } },
    {
      $group: {
        _id: {
          $cond: [
            { $or: [{ $eq: ['$temperature', null] }, { $eq: ['$temperature', ''] }] },
            'warm',
            '$temperature'
          ]
        },
        value: { $sum: 1 }
      }
    },
    {
      $project: {
        name: {
          $concat: [
            { $toUpper: { $substrCP: ['$_id', 0, 1] } },
            { $substrCP: ['$_id', 1, { $strLenCP: '$_id' }] }
          ]
        },
        value: 1,
        _id: 0
      }
    },
    { $sort: { name: 1 } }
  ]);

const escapeCSV = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const sendCsv = (res: Response, filename: string, headers: string[], rows: unknown[][]) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send([headers.join(','), ...rows.map((row) => row.map(escapeCSV).join(','))].join('\n'));
};

export const getReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const range = parseDateRange(req);

    const [summary, pipelineByStage, dealSourceMix, contactTemperature] = await Promise.all([
      getSummary(organizationId, range),
      getPipelineByStage(organizationId),
      getDealSourceMix(organizationId),
      getContactTemperature(organizationId)
    ]);

    res.json({
      status: true,
      message: 'Reports retrieved successfully',
      data: {
        summary,
        pipeline_by_stage: pipelineByStage,
        deal_source_mix: dealSourceMix,
        contact_temperature: contactTemperature
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch reports');
  }
};

export const getReportsSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Reports summary retrieved successfully',
      data: await getSummary(organizationId, parseDateRange(req))
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch reports summary');
  }
};

export const getReportsPipelineByStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Pipeline report retrieved successfully',
      data: await getPipelineByStage(organizationId)
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch pipeline report');
  }
};

export const getReportsDealSourceMix = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Deal source mix retrieved successfully',
      data: await getDealSourceMix(organizationId)
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch deal source mix');
  }
};

export const getReportsContactTemperature = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    res.json({
      status: true,
      message: 'Contact temperature retrieved successfully',
      data: await getContactTemperature(organizationId)
    });
  } catch (error) {
    handleError(res, error, 'Failed to fetch contact temperature');
  }
};

export const exportReports = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const type = String(req.query.type || 'summary');

    if (type === 'pipeline-by-stage') {
      const rows = await getPipelineByStage(organizationId);
      sendCsv(res, 'pipeline-by-stage.csv', ['name', 'count', 'value'], rows.map((row) => [row.name, row.count, row.value]));
      return;
    }

    if (type === 'deal-source-mix') {
      const rows = await getDealSourceMix(organizationId);
      sendCsv(res, 'deal-source-mix.csv', ['name', 'value'], rows.map((row) => [row.name, row.value]));
      return;
    }

    if (type === 'contact-temperature') {
      const rows = await getContactTemperature(organizationId);
      sendCsv(res, 'contact-temperature.csv', ['name', 'value'], rows.map((row) => [row.name, row.value]));
      return;
    }

    const summary = await getSummary(organizationId, parseDateRange(req));
    sendCsv(res, 'summary.csv', ['total_deals', 'open_value', 'won_value', 'lost_value'], [[
      summary.total_deals.current,
      summary.open_value.current,
      summary.won_value.current,
      summary.lost_value.current
    ]]);
  } catch (error) {
    handleError(res, error, 'Failed to export report');
  }
};
