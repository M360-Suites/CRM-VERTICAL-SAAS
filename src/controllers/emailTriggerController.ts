/**
 * Email triggers — user-configured "when X happens to a deal, send template Y"
 */
import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import {
  EmailTrigger,
  MAX_TRIGGER_DELAY_MINUTES,
  TRIGGER_EVENTS,
  TRIGGER_RECIPIENTS,
  type TriggerEvent,
  type TriggerRecipient
} from '../models/EmailTrigger';
import { TriggerRun } from '../models/TriggerRun';
import { EmailTemplate } from '../models/EmailTemplate';
import { Pipeline, PipelineStage } from '../models/Pipeline';
import { requireOrganization } from '../utils/tenant';
import { optionalEnum, optionalNumber, optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { logger } from '../config/logger';

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

type TriggerInput = {
  name?: string;
  event?: TriggerEvent;
  pipeline_id?: mongoose.Types.ObjectId | null;
  stage_id?: mongoose.Types.ObjectId | null;
  template_id?: mongoose.Types.ObjectId;
  recipient?: TriggerRecipient;
  delay_minutes?: number;
  min_deal_value?: number | null;
  is_active?: boolean;
};

/**
 * Parse a trigger body. `existing` is the stored trigger on PATCH so
 * cross-field rules (stage_entered needs a stage) see the merged result.
 */
const parseTriggerInput = async (
  organizationId: mongoose.Types.ObjectId,
  body: Record<string, unknown>,
  existing: { event: TriggerEvent; stage_id?: mongoose.Types.ObjectId; pipeline_id?: mongoose.Types.ObjectId } | null
): Promise<{ input: TriggerInput; errors: string[] }> => {
  const errors: string[] = [];
  const input: TriggerInput = {};
  const partial = Boolean(existing);

  const name = optionalString(body.name, 200);
  if (name === null || (!partial && !name)) errors.push('name is required (max 200 chars)');
  else if (name) input.name = name;

  const event = optionalEnum(body.event, TRIGGER_EVENTS);
  if (event === null || (!partial && !event)) errors.push(`event must be one of: ${TRIGGER_EVENTS.join(', ')}`);
  else if (event) input.event = event;

  const recipient = optionalEnum(body.recipient, TRIGGER_RECIPIENTS);
  if (recipient === null) errors.push(`recipient must be one of: ${TRIGGER_RECIPIENTS.join(', ')}`);
  else if (recipient) input.recipient = recipient;

  const delay = optionalNumber(body.delay_minutes, 0, MAX_TRIGGER_DELAY_MINUTES);
  if (delay === null) errors.push(`delay_minutes must be between 0 and ${MAX_TRIGGER_DELAY_MINUTES}`);
  else if (delay !== undefined) input.delay_minutes = Math.floor(delay);

  if ('min_deal_value' in body) {
    const minValue = optionalNumber(body.min_deal_value, 0, Number.MAX_SAFE_INTEGER);
    if (minValue === null) errors.push('min_deal_value must be a positive number');
    else input.min_deal_value = minValue ?? null;
  }

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') errors.push('is_active must be a boolean');
    else input.is_active = body.is_active;
  }

  if ('template_id' in body || !partial) {
    const templateId = optionalObjectId(body.template_id);
    if (!templateId) {
      errors.push('template_id is required');
    } else if (!(await EmailTemplate.exists({ _id: templateId, organization_id: organizationId }))) {
      errors.push('template_id must be a template in your organization');
    } else {
      input.template_id = templateId;
    }
  }

  if ('pipeline_id' in body) {
    const pipelineId = optionalObjectId(body.pipeline_id);
    if (pipelineId === null) errors.push('pipeline_id is invalid');
    else if (pipelineId && !(await Pipeline.exists({ _id: pipelineId, organization_id: organizationId }))) {
      errors.push('pipeline_id must be a pipeline in your organization');
    } else input.pipeline_id = pipelineId ?? null;
  }

  if ('stage_id' in body) {
    const stageId = optionalObjectId(body.stage_id);
    if (stageId === null) {
      errors.push('stage_id is invalid');
    } else if (stageId) {
      const stage = await PipelineStage.findOne({ _id: stageId, organization_id: organizationId }).select('pipeline_id').lean();
      if (!stage) errors.push('stage_id must be a stage in your organization');
      else if (input.pipeline_id && String(input.pipeline_id) !== String(stage.pipeline_id)) {
        errors.push('stage_id does not belong to pipeline_id');
      } else {
        input.stage_id = stageId;
        // A stage implies its pipeline
        input.pipeline_id = stage.pipeline_id;
      }
    } else {
      input.stage_id = null;
    }
  }

  const finalEvent = input.event ?? existing?.event;
  const finalStage = input.stage_id === undefined ? existing?.stage_id : input.stage_id;
  if (finalEvent === 'deal.stage_entered' && !finalStage) {
    errors.push('stage_id is required for deal.stage_entered triggers');
  }
  if (finalEvent && finalEvent !== 'deal.stage_entered' && input.stage_id) {
    errors.push('stage_id only applies to deal.stage_entered triggers');
  }

  return { input, errors };
};

const toUpdate = (input: TriggerInput) => {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) $unset[key] = 1;
    else if (value !== undefined) $set[key] = value;
  }
  return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
};

const refOrNull = (value: any) =>
  value ? { id: value._id ?? value, name: value.name ?? null } : null;

const serializeTrigger = (trigger: any) => ({
  id: trigger._id,
  name: trigger.name,
  event: trigger.event,
  pipeline: refOrNull(trigger.pipeline_id),
  stage: refOrNull(trigger.stage_id),
  template: refOrNull(trigger.template_id),
  recipient: trigger.recipient,
  delay_minutes: trigger.delay_minutes ?? 0,
  min_deal_value: trigger.min_deal_value ?? null,
  is_active: trigger.is_active,
  sent_count: trigger.sent_count ?? 0,
  last_fired_at: trigger.last_fired_at ?? null,
  created_at: trigger.created_at,
  updated_at: trigger.updated_at
});

const populateTrigger = <T extends { populate: (...args: any[]) => any }>(query: T) =>
  query.populate('pipeline_id', 'name').populate('stage_id', 'name').populate('template_id', 'name subject');

/**
 * GET /email-triggers/events — the events a trigger can listen for
 */
export const listTriggerEvents = (_req: AuthRequest, res: Response): void => {
  res.json({
    status: true,
    data: [
      { event: 'deal.stage_entered', label: 'Deal enters a stage', requires_stage: true },
      { event: 'deal.created', label: 'New deal is created', requires_stage: false },
      { event: 'deal.won', label: 'Deal is won', requires_stage: false },
      { event: 'deal.lost', label: 'Deal is lost', requires_stage: false }
    ]
  });
};

export const listTriggers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const filter: Record<string, unknown> = { organization_id: organizationId };
    const event = optionalEnum(req.query.event, TRIGGER_EVENTS);
    if (event) filter.event = event;
    const stageId = optionalObjectId(req.query.stage_id);
    if (stageId) filter.stage_id = stageId;

    const triggers = await populateTrigger(EmailTrigger.find(filter).sort({ created_at: -1 })).lean();
    res.json({ status: true, data: triggers.map(serializeTrigger) });
  } catch (error) {
    handleError(res, error, 'Failed to load email triggers');
  }
};

export const getTrigger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid trigger ID' });
      return;
    }

    const trigger = await populateTrigger(EmailTrigger.findOne({ _id: id, organization_id: organizationId })).lean();
    if (!trigger) {
      res.status(404).json({ status: false, message: 'Trigger not found' });
      return;
    }

    res.json({ status: true, data: serializeTrigger(trigger) });
  } catch (error) {
    handleError(res, error, 'Failed to load email trigger');
  }
};

export const createTrigger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, errors } = await parseTriggerInput(organizationId, req.body ?? {}, null);
    if (errors.length) {
      res.status(400).json({ status: false, message: errors.join('; '), errors });
      return;
    }

    const created = await EmailTrigger.create({
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined)),
      organization_id: organizationId,
      created_by: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined
    });
    const trigger = await populateTrigger(EmailTrigger.findById(created._id)).lean();

    res.status(201).json({ status: true, message: 'Trigger created', data: serializeTrigger(trigger) });
  } catch (error) {
    handleError(res, error, 'Failed to create email trigger');
  }
};

export const updateTrigger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid trigger ID' });
      return;
    }

    const existing = await EmailTrigger.findOne({ _id: id, organization_id: organizationId })
      .select('event stage_id pipeline_id')
      .lean();
    if (!existing) {
      res.status(404).json({ status: false, message: 'Trigger not found' });
      return;
    }

    const { input, errors } = await parseTriggerInput(organizationId, req.body ?? {}, existing);
    if (errors.length) {
      res.status(400).json({ status: false, message: errors.join('; '), errors });
      return;
    }
    // Switching away from stage_entered drops the stale stage
    if (input.event && input.event !== 'deal.stage_entered' && existing.stage_id && input.stage_id === undefined) {
      input.stage_id = null;
    }

    const trigger = await populateTrigger(
      EmailTrigger.findOneAndUpdate({ _id: id, organization_id: organizationId }, toUpdate(input), {
        new: true,
        runValidators: true
      })
    ).lean();

    res.json({ status: true, message: 'Trigger updated', data: serializeTrigger(trigger) });
  } catch (error) {
    handleError(res, error, 'Failed to update email trigger');
  }
};

/**
 * DELETE /email-triggers/:id — pending runs are skipped by the dispatcher
 */
export const deleteTrigger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid trigger ID' });
      return;
    }

    const result = await EmailTrigger.deleteOne({ _id: id, organization_id: organizationId });
    if (!result.deletedCount) {
      res.status(404).json({ status: false, message: 'Trigger not found' });
      return;
    }

    await TriggerRun.updateMany(
      { trigger_id: id, organization_id: organizationId, status: 'scheduled' },
      { $set: { status: 'skipped', error: 'Trigger was deleted' } }
    );

    res.json({ status: true, message: 'Trigger deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete email trigger');
  }
};

/**
 * GET /email-triggers/runs and /email-triggers/:id/runs — send history
 */
export const listTriggerRuns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const filter: Record<string, unknown> = { organization_id: organizationId };
    if (req.params.id) {
      const id = optionalObjectId(req.params.id);
      if (!id) {
        res.status(400).json({ status: false, message: 'Invalid trigger ID' });
        return;
      }
      filter.trigger_id = id;
    }
    const status = optionalEnum(req.query.status, ['scheduled', 'sending', 'sent', 'skipped', 'failed'] as const);
    if (status) filter.status = status;
    const dealId = optionalObjectId(req.query.deal_id);
    if (dealId) filter.deal_id = dealId;

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 50, 200);
    const [runs, total] = await Promise.all([
      TriggerRun.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('trigger_id', 'name')
        .populate('deal_id', 'title')
        .populate('stage_id', 'name')
        .lean(),
      TriggerRun.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: {
        data: runs.map((run: any) => ({
          id: run._id,
          trigger: refOrNull(run.trigger_id),
          deal: run.deal_id ? { id: run.deal_id._id ?? run.deal_id, title: run.deal_id.title ?? null } : null,
          stage: refOrNull(run.stage_id),
          event: run.event,
          status: run.status,
          to_email: run.to_email ?? null,
          subject: run.subject ?? null,
          error: run.error ?? null,
          send_at: run.send_at,
          sent_at: run.sent_at ?? null,
          created_at: run.created_at
        })),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load trigger history');
  }
};
