import mongoose from 'mongoose';
import config from '../config';
import { NurtureTemplate, NurtureChannel, INurtureTemplate } from '../models/NurtureTemplate';
import { NurtureDraft, INurtureDraft } from '../models/NurtureDraft';
import { generateNurtureText } from '../utils/groq';
import { recordWarehouseEvent } from '../utils/warehouse';

const SAFE_DEFAULT_BODY = 'Hi there, thanks for reaching out — when is a good time for a short call?';

export type MergeFields = Record<string, string | undefined | null>;

/**
 * Replace {{field}} merge tags. Unknown or empty fields are left as-is so a
 * reviewer can see what still needs filling before approving.
 */
export const fillTemplate = (text: string, fields: MergeFields): string =>
  text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, name: string) => {
    const value = fields[name.toLowerCase()];
    return value ? String(value) : match;
  });

/**
 * Pick the template for a channel: the explicit one if it belongs to the org,
 * otherwise an approved fallback for the channel, otherwise any approved fallback.
 */
export const pickTemplate = async (
  organizationId: mongoose.Types.ObjectId,
  channel: NurtureChannel,
  templateId?: string | null
): Promise<INurtureTemplate | null> => {
  if (templateId && mongoose.Types.ObjectId.isValid(templateId)) {
    const explicit = await NurtureTemplate.findOne({ _id: templateId, organization_id: organizationId, is_approved: true });
    if (explicit) return explicit;
  }

  return (
    (await NurtureTemplate.findOne({ organization_id: organizationId, is_approved: true, channel })
      .sort({ is_fallback: -1, created_at: 1 })) ??
    (await NurtureTemplate.findOne({ organization_id: organizationId, is_approved: true })
      .sort({ is_fallback: -1, created_at: 1 }))
  );
};

export interface NurtureContext {
  organizationId: mongoose.Types.ObjectId;
  contactId?: mongoose.Types.ObjectId;
  assigneeId?: mongoose.Types.ObjectId;
  actorId?: string;
  channel: NurtureChannel;
  templateId?: string | null;
  tone?: string;
  intentScore?: number;
  notes?: string;
  fields: MergeFields;
  /** Facts given to the model; never PII beyond what the rep already sees */
  promptFacts: string[];
}

/**
 * Write a pending draft straight from the best template (no AI). Used by
 * auto-routing so every new lead has a draft waiting the moment it lands.
 */
export const createTemplateDraft = async (ctx: NurtureContext): Promise<INurtureDraft | null> => {
  const started = Date.now();
  const template = await pickTemplate(ctx.organizationId, ctx.channel, ctx.templateId);
  if (!template) return null;

  return NurtureDraft.create({
    organization_id: ctx.organizationId,
    contact_id: ctx.contactId,
    template_id: template._id,
    assignee_id: ctx.assigneeId,
    channel: template.channel,
    subject: template.subject ? fillTemplate(template.subject, ctx.fields) : undefined,
    body: fillTemplate(template.body, ctx.fields),
    status: 'pending',
    intent_score: ctx.intentScore,
    latency_ms: Date.now() - started,
    ai_model: 'auto-route-template',
    prompt_log: `Auto-generated on lead creation from template: ${template.name}`
  });
};

const parseEmail = (text: string, fallbackSubject?: string): { subject?: string; body: string } => {
  const match = text.match(/^\s*Subject:\s*(.+?)\n+([\s\S]+)$/i);
  return match
    ? { subject: match[1].trim(), body: match[2].trim() }
    : { subject: fallbackSubject || 'Following up', body: text.trim() };
};

/**
 * AI-personalise an approved template into a pending draft. Falls back to the
 * filled template when the model is unavailable — a draft is always produced.
 */
export const generateAiDraft = async (ctx: NurtureContext): Promise<INurtureDraft> => {
  const started = Date.now();
  const template = await pickTemplate(ctx.organizationId, ctx.channel, ctx.templateId);

  const filledSubject = template?.subject ? fillTemplate(template.subject, ctx.fields) : undefined;
  const filledBody = template ? fillTemplate(template.body, ctx.fields) : SAFE_DEFAULT_BODY;

  const prompt = [
    `Channel: ${ctx.channel}`,
    ctx.tone ? `Tone: ${ctx.tone}` : '',
    ctx.intentScore !== undefined ? `Intent score: ${ctx.intentScore}/100` : '',
    ...ctx.promptFacts,
    ctx.notes ? `Rep notes: ${ctx.notes}` : '',
    template ? `Approved template to adapt (keep its structure and intent):\n${filledBody}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const instructions =
    ctx.channel === 'email'
      ? 'You are a B2B revenue nurture writer. Personalise the approved template for this lead. Never invent facts, prices, or commitments. Leave any remaining {{merge_fields}} untouched. Output exactly:\nSubject: <subject>\n\n<body>\nKeep the body under 140 words.'
      : `You are a B2B revenue nurture writer. Personalise the approved template for a ${ctx.channel} message. Never invent facts, prices, or commitments. Leave any remaining {{merge_fields}} untouched. Output the message text only, under 45 words.`;

  let model = config.GROQ_MODEL;
  let subject: string | undefined;
  let body: string;

  try {
    const text = await generateNurtureText(instructions, prompt);
    if (ctx.channel === 'email') {
      ({ subject, body } = parseEmail(text, filledSubject));
    } else {
      body = text.trim();
    }
  } catch {
    model = 'fallback-template';
    subject = filledSubject;
    body = filledBody;
  }

  const latency = Date.now() - started;
  const draft = await NurtureDraft.create({
    organization_id: ctx.organizationId,
    contact_id: ctx.contactId,
    template_id: template?._id,
    assignee_id: ctx.assigneeId,
    channel: ctx.channel,
    subject: ctx.channel === 'email' ? subject : undefined,
    body,
    status: 'pending',
    intent_score: ctx.intentScore,
    latency_ms: latency,
    prompt_log: prompt,
    ai_model: model
  });

  await recordWarehouseEvent({
    organizationId: ctx.organizationId,
    source: 'uroe',
    eventType: 'ai_draft_generated',
    entityType: 'nurture_draft',
    entityId: draft._id as mongoose.Types.ObjectId,
    actorId: ctx.actorId,
    payload: { channel: ctx.channel, model, latency_ms: latency, intent_score: ctx.intentScore ?? null }
  });

  return draft;
};
