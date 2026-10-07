/**
 * Email templates — the canvas-built emails used by triggers and broadcasts
 */
import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { EmailTemplate } from '../models/EmailTemplate';
import { EmailTrigger } from '../models/EmailTrigger';
import { requireOrganization } from '../utils/tenant';
import { optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { MERGE_VARIABLES, renderEmail, renderMergeTags, sampleMergeValues } from '../utils/emailTemplateRender';
import { sendSesEmail } from '../utils/sesMailer';
import { isSesConfigured } from '../config/ses';
import { logger } from '../config/logger';

/** Generous cap — inline-styled canvas output gets large, but SES rejects > 10MB */
const MAX_HTML_LENGTH = 500_000;

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

type TemplateInput = {
  name?: string;
  subject?: string;
  preview_text?: string | null;
  html?: string;
  design?: unknown;
};

const parseTemplateInput = (body: Record<string, unknown>, partial: boolean): { input: TemplateInput; errors: string[] } => {
  const errors: string[] = [];
  const input: TemplateInput = {};

  const name = optionalString(body.name, 200);
  if (name === null || (!partial && !name)) errors.push('name is required (max 200 chars)');
  else if (name) input.name = name;

  const subject = optionalString(body.subject, 300);
  if (subject === null || (!partial && !subject)) errors.push('subject is required (max 300 chars)');
  else if (subject) input.subject = subject;

  if ('preview_text' in body) {
    const preview = optionalString(body.preview_text, 300);
    if (preview === null) errors.push('preview_text must be a string (max 300 chars)');
    else input.preview_text = preview ?? null;
  }

  if ('html' in body || !partial) {
    if (typeof body.html !== 'string' || !body.html.trim()) errors.push('html is required');
    else if (body.html.length > MAX_HTML_LENGTH) errors.push(`html cannot exceed ${MAX_HTML_LENGTH} characters`);
    else input.html = body.html;
  }

  if ('design' in body) {
    if (body.design !== null && typeof body.design !== 'object') errors.push('design must be a JSON object');
    else input.design = body.design;
  }

  return { input, errors };
};

const serializeTemplate = (template: any, withContent = true) => ({
  id: template._id,
  name: template.name,
  subject: template.subject,
  preview_text: template.preview_text ?? null,
  ...(withContent ? { html: template.html, design: template.design ?? null } : {}),
  created_by: template.created_by ?? null,
  created_at: template.created_at,
  updated_at: template.updated_at
});

/**
 * GET /email-templates — newest first, without the heavy html/design
 */
export const listTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 50, 200);
    const filter: Record<string, unknown> = { organization_id: organizationId };
    const search = optionalString(req.query.search, 100);
    if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const [templates, total] = await Promise.all([
      EmailTemplate.find(filter).select('-html -design').sort({ updated_at: -1 }).skip(skip).limit(limit).lean(),
      EmailTemplate.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: {
        data: templates.map((template) => serializeTemplate(template, false)),
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load email templates');
  }
};

/**
 * GET /email-templates/variables — merge tags the canvas can insert
 */
export const listMergeVariables = (_req: AuthRequest, res: Response): void => {
  res.json({
    status: true,
    data: MERGE_VARIABLES.map((variable) => ({ ...variable, tag: `{{${variable.key}}}` }))
  });
};

export const getTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid template ID' });
      return;
    }

    const template = await EmailTemplate.findOne({ _id: id, organization_id: organizationId }).lean();
    if (!template) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    res.json({ status: true, data: serializeTemplate(template) });
  } catch (error) {
    handleError(res, error, 'Failed to load email template');
  }
};

export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, errors } = parseTemplateInput(req.body ?? {}, false);
    if (errors.length) {
      res.status(400).json({ status: false, message: errors.join('; '), errors });
      return;
    }

    const userId = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined;
    const template = await EmailTemplate.create({
      ...input,
      preview_text: input.preview_text ?? undefined,
      organization_id: organizationId,
      created_by: userId,
      updated_by: userId
    });

    res.status(201).json({ status: true, message: 'Template created', data: serializeTemplate(template.toObject()) });
  } catch (error) {
    handleError(res, error, 'Failed to create email template');
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid template ID' });
      return;
    }

    const { input, errors } = parseTemplateInput(req.body ?? {}, true);
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
    if (req.user?.id) $set.updated_by = new mongoose.Types.ObjectId(req.user.id);

    const template = await EmailTemplate.findOneAndUpdate(
      { _id: id, organization_id: organizationId },
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true }
    ).lean();
    if (!template) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    res.json({ status: true, message: 'Template updated', data: serializeTemplate(template) });
  } catch (error) {
    handleError(res, error, 'Failed to update email template');
  }
};

/**
 * POST /email-templates/:id/duplicate
 */
export const duplicateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid template ID' });
      return;
    }

    const source = await EmailTemplate.findOne({ _id: id, organization_id: organizationId }).lean();
    if (!source) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    const userId = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined;
    const copy = await EmailTemplate.create({
      organization_id: organizationId,
      name: `${source.name} (copy)`.slice(0, 200),
      subject: source.subject,
      preview_text: source.preview_text,
      html: source.html,
      design: source.design,
      created_by: userId,
      updated_by: userId
    });

    res.status(201).json({ status: true, message: 'Template duplicated', data: serializeTemplate(copy.toObject()) });
  } catch (error) {
    handleError(res, error, 'Failed to duplicate email template');
  }
};

/**
 * DELETE /email-templates/:id — blocked while a trigger still uses it
 */
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid template ID' });
      return;
    }

    const usedBy = await EmailTrigger.find({ organization_id: organizationId, template_id: id }).select('name').lean();
    if (usedBy.length) {
      res.status(409).json({
        status: false,
        message: `Template is used by ${usedBy.length} trigger(s) — change or delete them first`,
        data: { triggers: usedBy.map((trigger) => ({ id: trigger._id, name: trigger.name })) }
      });
      return;
    }

    const result = await EmailTemplate.deleteOne({ _id: id, organization_id: organizationId });
    if (!result.deletedCount) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    res.json({ status: true, message: 'Template deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete email template');
  }
};

/**
 * POST /email-templates/preview — render unsaved canvas content with sample data.
 * Body: { subject, html, preview_text? }
 */
export const previewTemplate = (req: AuthRequest, res: Response): void => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.html !== 'string' || typeof body.subject !== 'string') {
    res.status(400).json({ status: false, message: 'subject and html are required' });
    return;
  }

  const values = sampleMergeValues();
  res.json({
    status: true,
    data: {
      subject: renderMergeTags(body.subject, values, { html: false }),
      html: renderMergeTags(body.html, values, { html: true })
    }
  });
};

/**
 * POST /email-templates/:id/test — send the template to the current user with sample data
 */
export const sendTestTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    if (!isSesConfigured()) {
      res.status(503).json({ status: false, message: 'Email sending is not configured' });
      return;
    }

    const id = optionalObjectId(req.params.id);
    if (!id) {
      res.status(400).json({ status: false, message: 'Invalid template ID' });
      return;
    }

    const template = await EmailTemplate.findOne({ _id: id, organization_id: organizationId }).lean();
    if (!template || !req.user?.email) {
      res.status(404).json({ status: false, message: 'Template not found' });
      return;
    }

    const rendered = renderEmail(template, {}, sampleMergeValues());
    await sendSesEmail({
      to: req.user.email,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html,
      tags: { kind: 'template_test' }
    });

    res.json({ status: true, message: `Test email sent to ${req.user.email}` });
  } catch (error) {
    handleError(res, error, 'Failed to send test email');
  }
};
