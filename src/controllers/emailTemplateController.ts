/**
 * Email templates — the canvas-built emails used by triggers and broadcasts
 */
import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { EMAIL_TEMPLATE_CATEGORIES, EMAIL_TEMPLATE_CATEGORY_VALUES, EmailTemplate, type EmailTemplateCategory } from '../models/EmailTemplate';
import { EmailTrigger } from '../models/EmailTrigger';
import { Organization } from '../models/Organization';
import { requireOrganization } from '../utils/tenant';
import { optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { MERGE_VARIABLES, renderEmail, renderMergeTags, sampleMergeValues, testMergeValues } from '../utils/emailTemplateRender';
import { isEmailConfigured, sendEmail } from '../utils/ensendMailer';
import { logger } from '../config/logger';
import { handleError } from '../utils/errorHandler';

/** Generous cap — inline-styled canvas output gets large, but mail providers reject very large messages */
const MAX_HTML_LENGTH = 500_000;

const CATEGORY_ERROR = `category must be one of: ${EMAIL_TEMPLATE_CATEGORY_VALUES.join(', ')}`;

const isCategory = (value: string): value is EmailTemplateCategory =>
  (EMAIL_TEMPLATE_CATEGORY_VALUES as readonly string[]).includes(value);

/**
 * Parse the list's `category` filter: a comma-separated list (`?category=welcome,newsletter`),
 * also accepted as a repeated param. Returns undefined when absent, null when any value is unknown.
 */
const parseCategoryFilter = (raw: unknown): EmailTemplateCategory[] | undefined | null => {
  if (raw === undefined) return undefined;
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((value) => (typeof value === 'string' ? value.split(',') : [null]));
  const values: EmailTemplateCategory[] = [];
  for (const part of parts) {
    if (part === null) return null;
    const value = part.trim();
    if (!value) continue;
    if (!isCategory(value)) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values.length ? values : undefined;
};

type TemplateInput = {
  name?: string;
  subject?: string;
  preview_text?: string | null;
  category?: EmailTemplateCategory | null;
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

  if ('category' in body) {
    const category = body.category;
    if (category === null || category === '') input.category = null;
    else if (typeof category !== 'string' || !isCategory(category.trim())) errors.push(CATEGORY_ERROR);
    else input.category = category.trim() as EmailTemplateCategory;
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

/**
 * `full` returns html + design (detail endpoints); `list` returns design only, so list
 * cards can draw a preview without the heavy rendered html.
 */
const serializeTemplate = (template: any, content: 'full' | 'list' = 'full') => ({
  id: template._id,
  name: template.name,
  subject: template.subject,
  preview_text: template.preview_text ?? null,
  category: template.category ?? null,
  ...(content === 'full' ? { html: template.html } : {}),
  design: template.design ?? null,
  created_by: template.created_by ?? null,
  created_at: template.created_at,
  updated_at: template.updated_at
});

/**
 * GET /email-templates — newest first. Items carry design (for card previews) but not html.
 * Query: search, category (comma-separated, any-of), page, limit.
 */
export const listTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 50, 200);
    const filter: Record<string, unknown> = { organization_id: organizationId };
    const search = optionalString(req.query.search, 100);
    if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const categories = parseCategoryFilter(req.query.category);
    if (categories === null) {
      res.status(400).json({ status: false, message: CATEGORY_ERROR });
      return;
    }
    if (categories) filter.category = { $in: categories };

    const [templates, total] = await Promise.all([
      EmailTemplate.find(filter).select('-html').sort({ updated_at: -1 }).skip(skip).limit(limit).lean(),
      EmailTemplate.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: {
        data: templates.map((template) => serializeTemplate(template, 'list')),
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
 * GET /email-templates/categories — every category with its template count, for the sidebar.
 * `uncategorized` counts templates saved without a category.
 */
export const listCategories = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const groups: Array<{ _id: string | null; count: number }> = await EmailTemplate.aggregate([
      { $match: { organization_id: organizationId } },
      { $group: { _id: { $ifNull: ['$category', null] }, count: { $sum: 1 } } }
    ]);
    const counts = new Map(groups.map((group) => [group._id, group.count]));

    res.json({
      status: true,
      data: {
        categories: EMAIL_TEMPLATE_CATEGORIES.map(({ value, label }) => ({ value, label, count: counts.get(value) ?? 0 })),
        uncategorized: counts.get(null) ?? 0
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load email template categories');
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
      category: input.category ?? undefined,
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
      category: source.category,
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

    if (!isEmailConfigured()) {
      res.status(503).json({ status: false, message: 'Email sending is not configured. Set ENSEND_SECRET (and ENSEND_MAIL to a verified Ensend sender identity).' });
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

    const organization = await Organization.findById(organizationId).select('name').lean();
    const rendered = renderEmail(template, {}, testMergeValues({ email: req.user.email, name: req.user.display_name }, organization));
    await sendEmail({
      to: req.user.email,
      subject: `[Test] ${rendered.subject}`,
      html: rendered.html
    });

    res.json({ status: true, message: `Test email sent to ${req.user.email}` });
  } catch (error) {
    handleError(res, error, 'Failed to send test email');
  }
};
