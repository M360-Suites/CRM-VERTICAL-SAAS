import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { NurtureDraft, DRAFT_STATUSES, DraftStatus } from '../models/NurtureDraft';
import { NurtureTemplate, NURTURE_CHANNELS } from '../models/NurtureTemplate';
import { Contact } from '../models/Contact';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { Organization } from '../models/Organization';
import { requireOrganization } from '../utils/tenant';
import { recordWarehouseEvent } from '../utils/warehouse';
import { optionalEnum, optionalNumber, optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { generateAiDraft } from '../services/nurtureService';
import { logger } from '../config/logger';

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

const TONES = ['Consultative', 'Direct', 'Friendly', 'Formal', 'Brief', 'Neutral'] as const;

/** Allowed review transitions — nothing reaches a lead without passing through approved */
const TRANSITIONS: Record<DraftStatus, DraftStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['sent', 'rejected'],
  rejected: [],
  sent: []
};

const serializeDraft = (draft: any) => {
  const contact = draft.contact_id && typeof draft.contact_id === 'object' && 'first_name' in draft.contact_id
    ? draft.contact_id
    : null;
  return {
    id: draft._id,
    contact: contact
      ? { id: contact._id, first_name: contact.first_name, last_name: contact.last_name, email: contact.email ?? null }
      : null,
    template_id: draft.template_id ?? null,
    assignee_id: draft.assignee_id ?? null,
    channel: draft.channel,
    subject: draft.subject ?? null,
    body: draft.body,
    status: draft.status,
    intent_score: draft.intent_score ?? null,
    latency_ms: draft.latency_ms ?? null,
    model: draft.ai_model ?? null,
    reviewed_by: draft.reviewed_by ?? null,
    reviewed_at: draft.reviewed_at ?? null,
    created_at: draft.created_at
  };
};

/**
 * GET /revops/drafts — approval queue plus counters
 * Query: status, page, limit (default 100)
 */
export const listDrafts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const status = optionalEnum(req.query.status, DRAFT_STATUSES);
    if (status === null) {
      res.status(400).json({ status: false, message: 'Unknown status' });
      return;
    }
    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 100, 200);
    const filter = { organization_id: organizationId, ...(status ? { status } : {}) };

    const [drafts, total, stats] = await Promise.all([
      NurtureDraft.find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contact_id', 'first_name last_name email')
        .lean(),
      NurtureDraft.countDocuments(filter),
      NurtureDraft.aggregate<{ _id: string; count: number; latency: number }>([
        { $match: { organization_id: organizationId } },
        { $group: { _id: '$status', count: { $sum: 1 }, latency: { $avg: '$latency_ms' } } }
      ])
    ]);

    const countFor = (key: string) => stats.find((row) => row._id === key)?.count ?? 0;
    const allCount = stats.reduce((sum, row) => sum + row.count, 0);
    const avgLatency = allCount
      ? stats.reduce((sum, row) => sum + (row.latency ?? 0) * row.count, 0) / allCount
      : 0;

    res.json({
      status: true,
      data: {
        stats: {
          pending: countFor('pending'),
          approved: countFor('approved'),
          rejected: countFor('rejected'),
          sent: countFor('sent'),
          avg_latency_ms: Math.round(avgLatency)
        },
        drafts: drafts.map(serializeDraft)
      },
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load drafts');
  }
};

/**
 * POST /revops/drafts/generate
 * Body: { contact_id, channel, template_id?, tone?, intent_score?, notes? }
 * AI adapts an approved template; always lands as pending.
 */
export const generateDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const body = req.body ?? {};
    const contactId = optionalObjectId(body.contact_id);
    const channel = optionalEnum(body.channel ?? 'email', NURTURE_CHANNELS);
    const templateId = optionalObjectId(body.template_id);
    const tone = optionalEnum(body.tone, TONES);
    const intentScore = optionalNumber(body.intent_score, 0, 100);
    const notes = optionalString(body.notes, 1000);

    const errors = [
      !contactId && 'contact_id is required',
      !channel && 'channel must be email, whatsapp or sms',
      templateId === null && 'template_id is invalid',
      tone === null && `tone must be one of ${TONES.join(', ')}`,
      intentScore === null && 'intent_score must be between 0 and 100',
      notes === null && 'notes must be under 1000 characters'
    ].filter(Boolean);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }

    const contact = await Contact.findOne({ _id: contactId, organization_id: organizationId })
      .select('first_name last_name role_title temperature tags company_id routing')
      .lean();
    if (!contact) {
      res.status(404).json({ status: false, message: 'Contact not found' });
      return;
    }

    const [company, rep, organization] = await Promise.all([
      contact.company_id
        ? Company.findOne({ _id: contact.company_id, organization_id: organizationId }).select('name industry').lean()
        : null,
      User.findById(req.user?.id).select('display_name').lean(),
      Organization.findById(organizationId).select('name').lean()
    ]);

    const draft = await generateAiDraft({
      organizationId,
      contactId: contact._id as mongoose.Types.ObjectId,
      assigneeId: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      actorId: req.user?.id,
      channel: channel!,
      templateId: templateId?.toString(),
      tone: tone ?? 'Consultative',
      intentScore: intentScore ?? contact.routing?.intent_score ?? 50,
      notes: notes ?? undefined,
      fields: {
        first_name: contact.first_name,
        company: company?.name,
        industry: company?.industry,
        rep_name: rep?.display_name,
        our_company: organization?.name
      },
      promptFacts: [
        `Contact: ${contact.first_name} ${contact.last_name}${contact.role_title ? `, ${contact.role_title}` : ''}`,
        company?.name ? `Company: ${company.name}${company.industry ? ` (${company.industry})` : ''}` : '',
        contact.temperature ? `Lead temperature: ${contact.temperature}` : '',
        contact.tags?.length ? `Tags: ${contact.tags.join(', ')}` : ''
      ].filter(Boolean)
    });

    const populated = await NurtureDraft.findById(draft._id).populate('contact_id', 'first_name last_name email').lean();
    res.status(201).json({
      status: true,
      message: `Draft ready in ${draft.latency_ms}ms — awaiting approval`,
      data: serializeDraft(populated)
    });
  } catch (error) {
    handleError(res, error, 'Failed to generate draft');
  }
};

/**
 * PATCH /revops/drafts/:id — edit subject/body while the draft is still pending
 */
export const editDraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const subject = optionalString(req.body?.subject, 300);
    const body = optionalString(req.body?.body, 5000);
    if (subject === null || body === null || (subject === undefined && body === undefined)) {
      res.status(400).json({ status: false, message: 'Provide subject and/or body (body max 5000 chars)' });
      return;
    }

    const draftId = optionalObjectId(req.params.id);
    const draft = draftId
      ? await NurtureDraft.findOneAndUpdate(
          { _id: draftId, organization_id: organizationId, status: 'pending' },
          { $set: { ...(subject !== undefined ? { subject } : {}), ...(body !== undefined ? { body } : {}) } },
          { new: true }
        )
          .populate('contact_id', 'first_name last_name email')
          .lean()
      : null;
    if (!draft) {
      res.status(404).json({ status: false, message: 'Pending draft not found' });
      return;
    }

    res.json({ status: true, message: 'Draft updated', data: serializeDraft(draft) });
  } catch (error) {
    handleError(res, error, 'Failed to update draft');
  }
};

/**
 * PATCH /revops/drafts/:id/status — body { status }
 * pending → approved | rejected; approved → sent | rejected
 */
export const updateDraftStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const status = optionalEnum(req.body?.status, DRAFT_STATUSES);
    if (!status) {
      res.status(400).json({ status: false, message: 'status must be approved, rejected or sent' });
      return;
    }

    const draftId = optionalObjectId(req.params.id);
    const draft = draftId ? await NurtureDraft.findOne({ _id: draftId, organization_id: organizationId }) : null;
    if (!draft) {
      res.status(404).json({ status: false, message: 'Draft not found' });
      return;
    }

    if (!TRANSITIONS[draft.status].includes(status)) {
      res.status(409).json({ status: false, message: `Cannot move a ${draft.status} draft to ${status}` });
      return;
    }

    // Conditional update so two reviewers can't both act on the same state
    const updated = await NurtureDraft.findOneAndUpdate(
      { _id: draft._id, organization_id: organizationId, status: draft.status },
      { $set: { status, reviewed_by: req.user?.id, reviewed_at: new Date() } },
      { new: true }
    )
      .populate('contact_id', 'first_name last_name email')
      .lean();
    if (!updated) {
      res.status(409).json({ status: false, message: 'Draft was changed by someone else — refresh and retry' });
      return;
    }

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: `draft_${status}`,
      entityType: 'nurture_draft',
      entityId: draft._id as mongoose.Types.ObjectId,
      actorId: req.user?.id,
      payload: { from: draft.status, status, channel: draft.channel }
    });

    res.json({ status: true, message: `Draft ${status}`, data: serializeDraft(updated) });
  } catch (error) {
    handleError(res, error, 'Failed to update draft status');
  }
};

/* ---------------- Template library ---------------- */

const parseTemplateInput = (body: Record<string, unknown>, partial: boolean) => {
  const errors: string[] = [];
  const input: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};

  const name = optionalString(body.name, 120);
  if (name === null || (!partial && !name)) errors.push('name is required (max 120 chars)');
  else if (name) input.name = name;

  const templateBody = optionalString(body.body, 5000);
  if (templateBody === null || (!partial && !templateBody)) errors.push('body is required (max 5000 chars)');
  else if (templateBody) input.body = templateBody;

  const channel = optionalEnum(body.channel, NURTURE_CHANNELS);
  if (channel === null) errors.push('channel must be email, whatsapp or sms');
  else if (channel) input.channel = channel;

  for (const field of ['tone', 'stage', 'subject'] as const) {
    if (!(field in body)) continue;
    const value = optionalString(body[field], field === 'subject' ? 300 : 60);
    if (value === null) errors.push(`${field} is invalid`);
    else if (value) input[field] = value;
    else unset[field] = 1;
  }

  for (const field of ['is_fallback', 'is_approved'] as const) {
    if (!(field in body)) continue;
    if (typeof body[field] !== 'boolean') errors.push(`${field} must be a boolean`);
    else input[field] = body[field];
  }

  return { input, unset, errors };
};

/**
 * GET /revops/templates — Query: channel
 */
export const listTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const channel = optionalEnum(req.query.channel, NURTURE_CHANNELS);
    if (channel === null) {
      res.status(400).json({ status: false, message: 'Unknown channel' });
      return;
    }

    const templates = await NurtureTemplate.find({ organization_id: organizationId, ...(channel ? { channel } : {}) })
      .sort({ created_at: 1 })
      .lean();
    res.json({ status: true, data: templates });
  } catch (error) {
    handleError(res, error, 'Failed to load templates');
  }
};

/**
 * POST /revops/templates
 */
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, errors } = parseTemplateInput(req.body ?? {}, false);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }

    const template = await NurtureTemplate.create({ organization_id: organizationId, ...input });

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'template_created',
      entityType: 'nurture_template',
      entityId: template._id as mongoose.Types.ObjectId,
      actorId: req.user?.id,
      payload: { name: template.name, channel: template.channel, is_fallback: template.is_fallback }
    });

    res.status(201).json({ status: true, message: 'Template saved', data: template });
  } catch (error) {
    handleError(res, error, 'Failed to save template');
  }
};

/**
 * PATCH /revops/templates/:id
 */
export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, unset, errors } = parseTemplateInput(req.body ?? {}, true);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }
    if (!Object.keys(input).length && !Object.keys(unset).length) {
      res.status(400).json({ status: false, message: 'Nothing to update' });
      return;
    }

    const templateId = optionalObjectId(req.params.id);
    const template = templateId
      ? await NurtureTemplate.findOneAndUpdate(
          { _id: templateId, organization_id: organizationId },
          { ...(Object.keys(input).length ? { $set: input } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
          { new: true }
        ).lean()
      : null;
    if (!template) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'template_updated',
      entityType: 'nurture_template',
      entityId: templateId!,
      actorId: req.user?.id,
      payload: { fields: [...Object.keys(input), ...Object.keys(unset)] }
    });

    res.json({ status: true, message: 'Template updated', data: template });
  } catch (error) {
    handleError(res, error, 'Failed to update template');
  }
};

/**
 * DELETE /revops/templates/:id
 */
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const templateId = optionalObjectId(req.params.id);
    const template = templateId
      ? await NurtureTemplate.findOneAndDelete({ _id: templateId, organization_id: organizationId })
      : null;
    if (!template) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'template_deleted',
      entityType: 'nurture_template',
      entityId: template._id as mongoose.Types.ObjectId,
      actorId: req.user?.id,
      payload: { name: template.name }
    });

    res.json({ status: true, message: 'Template deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete template');
  }
};
