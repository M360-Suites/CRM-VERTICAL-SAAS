/**
 * Broadcasts — bulk email to contacts through Amazon SES, with send history
 */
import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { Broadcast, type IBroadcastAudience } from '../models/Broadcast';
import { BroadcastRecipient } from '../models/BroadcastRecipient';
import { EmailTemplate } from '../models/EmailTemplate';
import { Contact, type Temperature } from '../models/Contact';
import { Organization } from '../models/Organization';
import { requireOrganization } from '../utils/tenant';
import { optionalEnum, optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { renderEmail, sampleMergeValues } from '../utils/emailTemplateRender';
import { sendSesEmail } from '../utils/sesMailer';
import { isSesConfigured } from '../config/ses';
import { buildAudienceFilter, cancelBroadcast, startBroadcast } from '../services/broadcastService';
import { logger } from '../config/logger';

const MAX_HTML_LENGTH = 500_000;
const MAX_AUDIENCE_IDS = 10_000;
const BROADCAST_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'] as const;
const RECIPIENT_STATUSES = ['queued', 'sending', 'sent', 'failed', 'bounced', 'complained', 'skipped'] as const;
const TEMPERATURES: readonly Temperature[] = ['hot', 'warm', 'cold'];

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseIdList = (value: unknown, field: string, errors: string[]): mongoose.Types.ObjectId[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_AUDIENCE_IDS) {
    errors.push(`audience.${field} must be an array of up to ${MAX_AUDIENCE_IDS} IDs`);
    return undefined;
  }
  const ids = value.map((id) => optionalObjectId(id));
  if (ids.some((id) => !id)) {
    errors.push(`audience.${field} contains an invalid ID`);
    return undefined;
  }
  return ids as mongoose.Types.ObjectId[];
};

const parseAudience = (value: unknown, errors: string[]): IBroadcastAudience | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('audience must be an object');
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const audience: IBroadcastAudience = { all: raw.all === true };

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== 'string')) errors.push('audience.tags must be an array of strings');
    else audience.tags = (raw.tags as string[]).map((tag) => tag.trim()).filter(Boolean);
  }
  if (raw.temperature !== undefined) {
    if (!Array.isArray(raw.temperature) || raw.temperature.some((t) => !TEMPERATURES.includes(t as Temperature))) {
      errors.push('audience.temperature must be an array of hot, warm, cold');
    } else audience.temperature = raw.temperature as Temperature[];
  }
  audience.owner_ids = parseIdList(raw.owner_ids, 'owner_ids', errors);
  audience.company_ids = parseIdList(raw.company_ids, 'company_ids', errors);
  audience.contact_ids = parseIdList(raw.contact_ids, 'contact_ids', errors);

  return audience;
};

type BroadcastInput = {
  name?: string;
  subject?: string;
  preview_text?: string | null;
  html?: string;
  template_id?: mongoose.Types.ObjectId | null;
  audience?: IBroadcastAudience;
};

/**
 * When template_id is given, subject/html/preview_text default to the template's.
 */
const parseBroadcastInput = async (
  organizationId: mongoose.Types.ObjectId,
  body: Record<string, unknown>,
  partial: boolean
): Promise<{ input: BroadcastInput; errors: string[] }> => {
  const errors: string[] = [];
  const input: BroadcastInput = {};

  if ('template_id' in body) {
    const templateId = optionalObjectId(body.template_id);
    if (templateId === null) errors.push('template_id is invalid');
    else if (templateId) {
      const template = await EmailTemplate.findOne({ _id: templateId, organization_id: organizationId })
        .select('subject html preview_text')
        .lean();
      if (!template) errors.push('template_id must be a template in your organization');
      else {
        input.template_id = templateId;
        input.subject = template.subject;
        input.html = template.html;
        if (template.preview_text) input.preview_text = template.preview_text;
      }
    } else input.template_id = null;
  }

  const name = optionalString(body.name, 200);
  if (name === null || (!partial && !name)) errors.push('name is required (max 200 chars)');
  else if (name) input.name = name;

  const subject = optionalString(body.subject, 300);
  if (subject === null) errors.push('subject must be at most 300 chars');
  else if (subject) input.subject = subject;
  if (!partial && !input.subject) errors.push('subject is required (or pass template_id)');

  if ('preview_text' in body) {
    const preview = optionalString(body.preview_text, 300);
    if (preview === null) errors.push('preview_text must be at most 300 chars');
    else input.preview_text = preview ?? null;
  }

  if ('html' in body) {
    if (typeof body.html !== 'string' || !body.html.trim()) errors.push('html must be a non-empty string');
    else if (body.html.length > MAX_HTML_LENGTH) errors.push(`html cannot exceed ${MAX_HTML_LENGTH} characters`);
    else input.html = body.html;
  }
  if (!partial && !input.html) errors.push('html is required (or pass template_id)');

  const audience = parseAudience(body.audience, errors);
  if (audience) input.audience = audience;

  return { input, errors };
};

const serializeBroadcast = (broadcast: any, withContent = false) => ({
  id: broadcast._id,
  name: broadcast.name,
  subject: broadcast.subject,
  preview_text: broadcast.preview_text ?? null,
  ...(withContent ? { html: broadcast.html } : {}),
  template_id: broadcast.template_id ?? null,
  audience: broadcast.audience ?? { all: true },
  status: broadcast.status,
  scheduled_at: broadcast.scheduled_at ?? null,
  started_at: broadcast.started_at ?? null,
  completed_at: broadcast.completed_at ?? null,
  stats: broadcast.stats,
  error: broadcast.error ?? null,
  created_by: broadcast.created_by
    ? { id: broadcast.created_by._id ?? broadcast.created_by, display_name: broadcast.created_by.display_name ?? null }
    : null,
  sent_by: broadcast.sent_by
    ? { id: broadcast.sent_by._id ?? broadcast.sent_by, display_name: broadcast.sent_by.display_name ?? null }
    : null,
  created_at: broadcast.created_at,
  updated_at: broadcast.updated_at
});

const parseId = (req: AuthRequest, res: Response): mongoose.Types.ObjectId | null => {
  const id = optionalObjectId(req.params.id);
  if (!id) {
    res.status(400).json({ status: false, message: 'Invalid broadcast ID' });
    return null;
  }
  return id;
};

/**
 * GET /broadcasts — send history, newest first
 */
export const listBroadcasts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const filter: Record<string, unknown> = { organization_id: organizationId };
    const status = optionalEnum(req.query.status, BROADCAST_STATUSES);
    if (status) filter.status = status;
    const search = optionalString(req.query.search, 100);
    if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 25, 100);
    const [broadcasts, total] = await Promise.all([
      Broadcast.find(filter)
        .select('-html')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('created_by', 'display_name')
        .populate('sent_by', 'display_name')
        .lean(),
      Broadcast.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: {
        data: broadcasts.map((broadcast) => serializeBroadcast(broadcast)),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load broadcasts');
  }
};

export const getBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    const broadcast = await Broadcast.findOne({ _id: id, organization_id: organizationId })
      .populate('created_by', 'display_name')
      .populate('sent_by', 'display_name')
      .lean();
    if (!broadcast) {
      res.status(404).json({ status: false, message: 'Broadcast not found' });
      return;
    }

    res.json({ status: true, data: serializeBroadcast(broadcast, true) });
  } catch (error) {
    handleError(res, error, 'Failed to load broadcast');
  }
};

export const createBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, errors } = await parseBroadcastInput(organizationId, req.body ?? {}, false);
    if (errors.length) {
      res.status(400).json({ status: false, message: errors.join('; '), errors });
      return;
    }

    const broadcast = await Broadcast.create({
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined)),
      organization_id: organizationId,
      created_by: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined
    });

    res.status(201).json({ status: true, message: 'Broadcast draft created', data: serializeBroadcast(broadcast.toObject(), true) });
  } catch (error) {
    handleError(res, error, 'Failed to create broadcast');
  }
};

/**
 * PATCH /broadcasts/:id — drafts and scheduled broadcasts only
 */
export const updateBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    const { input, errors } = await parseBroadcastInput(organizationId, req.body ?? {}, true);
    if (errors.length) {
      res.status(400).json({ status: false, message: errors.join('; '), errors });
      return;
    }

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === null) $unset[key] = 1;
      else if (value !== undefined) $set[key] = value;
    }

    const broadcast = await Broadcast.findOneAndUpdate(
      { _id: id, organization_id: organizationId, status: { $in: ['draft', 'scheduled'] } },
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true }
    ).lean();

    if (!broadcast) {
      const exists = await Broadcast.exists({ _id: id, organization_id: organizationId });
      res.status(exists ? 409 : 404).json({
        status: false,
        message: exists ? 'Only draft or scheduled broadcasts can be edited' : 'Broadcast not found'
      });
      return;
    }

    res.json({ status: true, message: 'Broadcast updated', data: serializeBroadcast(broadcast, true) });
  } catch (error) {
    handleError(res, error, 'Failed to update broadcast');
  }
};

/**
 * DELETE /broadcasts/:id — drafts only; sent broadcasts stay in history
 */
export const deleteBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    const result = await Broadcast.deleteOne({ _id: id, organization_id: organizationId, status: 'draft' });
    if (!result.deletedCount) {
      const exists = await Broadcast.exists({ _id: id, organization_id: organizationId });
      res.status(exists ? 409 : 404).json({
        status: false,
        message: exists ? 'Only drafts can be deleted — cancel a scheduled broadcast instead' : 'Broadcast not found'
      });
      return;
    }

    res.json({ status: true, message: 'Broadcast deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete broadcast');
  }
};

/**
 * POST /broadcasts/audience/preview — how many contacts an audience reaches
 * Body: { audience }
 */
export const previewAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const errors: string[] = [];
    const audience = parseAudience((req.body ?? {}).audience ?? {}, errors);
    if (errors.length || !audience) {
      res.status(400).json({ status: false, message: errors.join('; ') || 'audience is required', errors });
      return;
    }

    const filter = buildAudienceFilter(organizationId, audience);
    if (!filter) {
      res.json({ status: true, data: { count: 0, sample: [], opted_out: 0 } });
      return;
    }

    const { email_opt_out: _ignored, ...withoutOptOut } = filter;
    const [count, sample, total] = await Promise.all([
      Contact.countDocuments(filter),
      Contact.find(filter).select('first_name last_name email').sort({ created_at: -1 }).limit(5).lean(),
      Contact.countDocuments(withoutOptOut)
    ]);

    res.json({
      status: true,
      data: {
        count,
        opted_out: total - count,
        sample: sample.map((contact) => ({
          id: contact._id,
          name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
          email: contact.email
        }))
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to preview audience');
  }
};

/**
 * POST /broadcasts/:id/send — send now, or schedule with { scheduled_at }
 */
export const sendBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    if (!isSesConfigured()) {
      res.status(503).json({ status: false, message: 'Email sending is not configured' });
      return;
    }

    const broadcast = await Broadcast.findOne({ _id: id, organization_id: organizationId }).select('status audience').lean();
    if (!broadcast) {
      res.status(404).json({ status: false, message: 'Broadcast not found' });
      return;
    }
    if (!['draft', 'scheduled'].includes(broadcast.status)) {
      res.status(409).json({ status: false, message: `Broadcast is already ${broadcast.status}` });
      return;
    }
    if (!buildAudienceFilter(organizationId, broadcast.audience ?? {})) {
      res.status(400).json({ status: false, message: 'Choose an audience before sending' });
      return;
    }

    const userId = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined;
    const rawSchedule = (req.body ?? {}).scheduled_at;

    if (rawSchedule !== undefined && rawSchedule !== null && rawSchedule !== '') {
      const scheduledAt = new Date(rawSchedule);
      if (typeof rawSchedule !== 'string' || Number.isNaN(scheduledAt.getTime())) {
        res.status(400).json({ status: false, message: 'scheduled_at must be an ISO date-time' });
        return;
      }
      if (scheduledAt.getTime() > Date.now() + 60_000) {
        const scheduled = await Broadcast.findOneAndUpdate(
          { _id: id, organization_id: organizationId, status: { $in: ['draft', 'scheduled'] } },
          { $set: { status: 'scheduled', scheduled_at: scheduledAt, ...(userId ? { sent_by: userId } : {}) } },
          { new: true }
        ).lean();
        res.json({ status: true, message: 'Broadcast scheduled', data: serializeBroadcast(scheduled) });
        return;
      }
    }

    const queued = await startBroadcast(id, userId);
    const updated = await Broadcast.findById(id).lean();

    if (queued === 0) {
      res.status(400).json({ status: false, message: 'No eligible recipients in the audience', data: serializeBroadcast(updated) });
      return;
    }

    res.status(202).json({ status: true, message: `Sending to ${queued} contacts`, data: serializeBroadcast(updated) });
  } catch (error) {
    handleError(res, error, 'Failed to send broadcast');
  }
};

/**
 * POST /broadcasts/:id/cancel — stop a scheduled or in-progress broadcast
 */
export const cancelBroadcastHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    const broadcast = await cancelBroadcast(id, organizationId);
    if (!broadcast) {
      const exists = await Broadcast.exists({ _id: id, organization_id: organizationId });
      res.status(exists ? 409 : 404).json({
        status: false,
        message: exists ? 'Only scheduled or sending broadcasts can be cancelled' : 'Broadcast not found'
      });
      return;
    }

    const updated = await Broadcast.findById(id).lean();
    res.json({ status: true, message: 'Broadcast cancelled', data: serializeBroadcast(updated) });
  } catch (error) {
    handleError(res, error, 'Failed to cancel broadcast');
  }
};

/**
 * POST /broadcasts/:id/test — send the broadcast to the current user
 */
export const sendTestBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    if (!isSesConfigured()) {
      res.status(503).json({ status: false, message: 'Email sending is not configured' });
      return;
    }

    const [broadcast, organization] = await Promise.all([
      Broadcast.findOne({ _id: id, organization_id: organizationId }).select('subject html preview_text').lean(),
      Organization.findById(organizationId).select('name').lean()
    ]);
    if (!broadcast || !req.user?.email) {
      res.status(404).json({ status: false, message: 'Broadcast not found' });
      return;
    }

    const rendered = renderEmail(broadcast, { organization }, sampleMergeValues());
    await sendSesEmail({
      to: req.user.email,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      fromName: organization?.name,
      tags: { kind: 'broadcast_test' }
    });

    res.json({ status: true, message: `Test email sent to ${req.user.email}` });
  } catch (error) {
    handleError(res, error, 'Failed to send test email');
  }
};

/**
 * GET /broadcasts/:id/recipients — per-contact delivery history
 */
export const listBroadcastRecipients = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;
    const id = parseId(req, res);
    if (!id) return;

    const filter: Record<string, unknown> = { broadcast_id: id, organization_id: organizationId };
    const status = optionalEnum(req.query.status, RECIPIENT_STATUSES);
    if (status) filter.status = status;
    const search = optionalString(req.query.search, 100);
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: 'i' };
      filter.$or = [{ email: pattern }, { name: pattern }];
    }

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 50, 200);
    const [recipients, total] = await Promise.all([
      BroadcastRecipient.find(filter).sort({ created_at: 1 }).skip(skip).limit(limit).lean(),
      BroadcastRecipient.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: {
        data: recipients.map((recipient) => ({
          id: recipient._id,
          contact_id: recipient.contact_id,
          name: recipient.name ?? null,
          email: recipient.email,
          status: recipient.status,
          error: recipient.error ?? null,
          sent_at: recipient.sent_at ?? null
        })),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load broadcast recipients');
  }
};
