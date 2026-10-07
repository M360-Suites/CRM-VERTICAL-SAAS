/**
 * Email triggers
 *  - queueDealTriggers: called when a deal is created or changes stage; matches the
 *    org's active triggers and queues a TriggerRun (send_at = now + delay).
 *  - processTriggerRun: called by the dispatcher once a run is due; re-checks the
 *    deal still qualifies, renders the template and sends it through SES.
 */
import mongoose from 'mongoose';
import { EmailTrigger, type IEmailTrigger, type TriggerEvent } from '../models/EmailTrigger';
import { TriggerRun, type ITriggerRun } from '../models/TriggerRun';
import { EmailTemplate } from '../models/EmailTemplate';
import { Deal } from '../models/Deal';
import { PipelineStage } from '../models/Pipeline';
import { Organization } from '../models/Organization';
import { logger } from '../config/logger';
import { sendSesEmail } from '../utils/sesMailer';
import { buildUnsubscribeUrl, renderEmail } from '../utils/emailTemplateRender';

type ObjectIdLike = mongoose.Types.ObjectId | string;

export interface DealTriggerEvent {
  organizationId: ObjectIdLike;
  dealId: ObjectIdLike;
  /** Stage the deal just entered (omit when unchanged) */
  stageId?: ObjectIdLike | null;
  /** True when the deal was just created */
  isNew?: boolean;
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

const triggerMatches = (
  trigger: Pick<IEmailTrigger, 'event' | 'stage_id' | 'pipeline_id' | 'min_deal_value'>,
  stage: { _id: mongoose.Types.ObjectId; pipeline_id: mongoose.Types.ObjectId } | null,
  dealValue: number | undefined
): boolean => {
  if (trigger.event === 'deal.stage_entered' && String(trigger.stage_id) !== String(stage?._id)) return false;
  if (trigger.pipeline_id && String(trigger.pipeline_id) !== String(stage?.pipeline_id)) return false;
  if (typeof trigger.min_deal_value === 'number' && (dealValue ?? 0) < trigger.min_deal_value) return false;
  return true;
};

/**
 * Queue trigger runs for a deal event. Never throws — a trigger problem must
 * not fail the deal update that caused it.
 */
export const queueDealTriggers = async (event: DealTriggerEvent): Promise<void> => {
  try {
    const organizationId = new mongoose.Types.ObjectId(String(event.organizationId));
    const dealId = new mongoose.Types.ObjectId(String(event.dealId));

    const stage = event.stageId
      ? await PipelineStage.findOne({ _id: event.stageId, organization_id: organizationId })
          .select('_id pipeline_id is_won is_lost')
          .lean()
      : null;

    const events: TriggerEvent[] = [];
    if (event.isNew) events.push('deal.created');
    if (stage) {
      events.push('deal.stage_entered');
      if (stage.is_won) events.push('deal.won');
      if (stage.is_lost) events.push('deal.lost');
    }
    if (events.length === 0) return;

    const triggers = await EmailTrigger.find({ organization_id: organizationId, is_active: true, event: { $in: events } })
      .select('_id event stage_id pipeline_id min_deal_value delay_minutes')
      .lean();
    if (triggers.length === 0) return;

    const deal = await Deal.findOne({ _id: dealId, organization_id: organizationId }).select('value').lean();
    if (!deal) return;

    const now = Date.now();
    for (const trigger of triggers) {
      if (!triggerMatches(trigger, stage, deal.value)) continue;

      try {
        await TriggerRun.create({
          organization_id: organizationId,
          trigger_id: trigger._id,
          deal_id: dealId,
          stage_id: stage?._id,
          event: trigger.event,
          // A deal re-entering the same stage doesn't email twice
          dedupe_key: `${trigger._id}:${dealId}:${trigger.event}:${stage?._id ?? ''}`,
          send_at: new Date(now + (trigger.delay_minutes || 0) * 60_000)
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
  } catch (error) {
    logger.error({ err: error, dealId: String(event.dealId) }, 'Failed to queue email triggers');
  }
};

type PopulatedDeal = {
  _id: mongoose.Types.ObjectId;
  title: string;
  value?: number;
  currency?: string;
  stage_id?: { _id: mongoose.Types.ObjectId; name: string } | null;
  contact_id?: {
    _id: mongoose.Types.ObjectId;
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    role_title?: string;
    email_opt_out?: boolean;
  } | null;
  company_id?: { name: string } | null;
  owner_id?: { display_name: string; email: string } | null;
};

type RunOutcome = { status: 'sent' | 'skipped' | 'failed'; error?: string };

const finishRun = async (run: Pick<ITriggerRun, '_id'>, outcome: RunOutcome, extra: Record<string, unknown> = {}) => {
  await TriggerRun.updateOne({ _id: run._id }, { $set: { status: outcome.status, error: outcome.error, ...extra } });
};

/** Send one due run. The caller must already have claimed it (status 'sending'). */
export const processTriggerRun = async (run: ITriggerRun): Promise<RunOutcome> => {
  const skip = async (reason: string): Promise<RunOutcome> => {
    const outcome: RunOutcome = { status: 'skipped', error: reason };
    await finishRun(run, outcome);
    return outcome;
  };

  try {
    const trigger = await EmailTrigger.findOne({ _id: run.trigger_id, organization_id: run.organization_id }).lean();
    if (!trigger || !trigger.is_active) return skip('Trigger was paused or deleted before sending');

    const deal = (await Deal.findOne({ _id: run.deal_id, organization_id: run.organization_id })
      .populate('stage_id', 'name')
      .populate('contact_id', 'first_name last_name email phone role_title email_opt_out')
      .populate('company_id', 'name')
      .populate('owner_id', 'display_name email')
      .lean()) as unknown as PopulatedDeal | null;
    if (!deal) return skip('Deal was deleted');

    if (run.event === 'deal.stage_entered' && String(deal.stage_id?._id) !== String(run.stage_id)) {
      return skip('Deal left the stage before the email was due');
    }
    if (typeof trigger.min_deal_value === 'number' && (deal.value ?? 0) < trigger.min_deal_value) {
      return skip('Deal value is below the trigger minimum');
    }

    const template = await EmailTemplate.findOne({ _id: trigger.template_id, organization_id: run.organization_id }).lean();
    if (!template) {
      const outcome: RunOutcome = { status: 'failed', error: 'Template no longer exists' };
      await finishRun(run, outcome);
      return outcome;
    }

    const contact = deal.contact_id;
    let to: string | undefined;
    let unsubscribeUrl: string | undefined;

    if (trigger.recipient === 'deal_owner') {
      to = deal.owner_id?.email;
      if (!to) return skip('Deal has no owner email');
    } else {
      to = contact?.email;
      if (!contact || !to) return skip('Deal has no contact email');
      if (contact.email_opt_out) return skip('Contact has unsubscribed');
      unsubscribeUrl = buildUnsubscribeUrl(String(contact._id));
    }

    const organization = await Organization.findById(run.organization_id).select('name').lean();
    const rendered = renderEmail(template, {
      contact,
      company: deal.company_id,
      deal,
      stage: deal.stage_id,
      owner: deal.owner_id,
      organization,
      unsubscribe_url: unsubscribeUrl
    });

    const messageId = await sendSesEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      fromName: organization?.name,
      replyTo: trigger.recipient === 'contact' ? deal.owner_id?.email : undefined,
      unsubscribeUrl,
      tags: { kind: 'trigger', trigger_id: String(trigger._id), run_id: String(run._id) }
    });

    const sentAt = new Date();
    await finishRun(run, { status: 'sent' }, {
      to_email: to,
      subject: rendered.subject,
      ses_message_id: messageId,
      sent_at: sentAt,
      error: undefined
    });
    await EmailTrigger.updateOne({ _id: trigger._id }, { $inc: { sent_count: 1 }, $set: { last_fired_at: sentAt } });

    return { status: 'sent' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: error, runId: String(run._id) }, 'Email trigger send failed');
    const outcome: RunOutcome = { status: 'failed', error: message };
    await finishRun(run, outcome).catch(() => undefined);
    return outcome;
  }
};

/** Atomically claim the next due run, or null when none are due */
export const claimDueTriggerRun = async (): Promise<ITriggerRun | null> =>
  TriggerRun.findOneAndUpdate(
    { status: 'scheduled', send_at: { $lte: new Date() } },
    { $set: { status: 'sending' } },
    { sort: { send_at: 1 }, new: true }
  );
