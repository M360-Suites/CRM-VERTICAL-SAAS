import { Deal } from '../models/Deal';
import { PipelineStage } from '../models/Pipeline';
import { Organization } from '../models/Organization';
import { User } from '../models/User';
import { Activity } from '../models/Activity';
import { sendStaleLeadReminderEmail } from '../utils/email';
import { logger } from '../config/logger';

const DEFAULT_STAGE_NAMES = ['Qualified', 'Proposal'];
const DEFAULT_FIRST_REMINDER_DAYS = 2;
const DEFAULT_ESCALATION_DAYS = 5;
const DEFAULT_INTERVAL_MINUTES = 15;

let reminderTimer: NodeJS.Timeout | undefined;
let isRunning = false;

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getStageNames = (): string[] => {
  const value = process.env.STALE_REMINDER_STAGES;
  if (!value?.trim()) return DEFAULT_STAGE_NAMES;
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
};

type EmailUser = { email?: string; display_name?: string };

const buildRecipients = (assignees: EmailUser[], admins: EmailUser[]): Array<{ address: string; name: string }> => {
  const unique = new Map<string, { address: string; name: string }>();

  for (const user of [...assignees, ...admins]) {
    if (!user?.email) continue;
    const email = user.email.toLowerCase();
    unique.set(email, {
      address: email,
      name: user.display_name || ''
    });
  }

  return Array.from(unique.values());
};

/**
 * Checks open deals sitting in the configured stages (default Qualified/Proposal)
 * and emails the stage assignees + organization admins when a deal has stayed in
 * the same stage for too long.
 *  - First reminder: after 2 days
 *  - Escalation: after 5 days
 */
export const sendStaleDealReminders = async (): Promise<void> => {
  if (isRunning) return;

  isRunning = true;

  try {
    const now = new Date();
    const firstDays = toPositiveNumber(
      process.env.STALE_REMINDER_FIRST_DAYS,
      DEFAULT_FIRST_REMINDER_DAYS
    );
    const escalationDays = toPositiveNumber(
      process.env.STALE_REMINDER_ESCALATION_DAYS,
      DEFAULT_ESCALATION_DAYS
    );
    const firstCutoff = new Date(now.getTime() - firstDays * 24 * 60 * 60 * 1000);
    const escalationCutoff = new Date(now.getTime() - escalationDays * 24 * 60 * 60 * 1000);
    const stageNames = getStageNames();

    const stages = await PipelineStage.find({ name: { $in: stageNames } })
      .select('_id name assignees organization_id')
      .lean();

    if (stages.length === 0) return;

    const stageIds = stages.map((stage) => stage._id);

    const deals = await Deal.find({
      status: 'open',
      stage_id: { $in: stageIds },
      stage_changed_at: { $ne: null },
      $or: [
        { stage_changed_at: { $lte: escalationCutoff }, stale_reminder_escalated_at: null },
        { stage_changed_at: { $lte: firstCutoff }, stale_reminder_sent_at: null }
      ]
    })
      .populate('contact_id', 'first_name last_name')
      .populate('company_id', 'name')
      .lean();

    if (deals.length === 0) return;

    const stageById = new Map(stages.map((stage) => [stage._id.toString(), stage]));
    const orgIds = [...new Set(stages.map((stage) => stage.organization_id.toString()))];

    const organizations = await Organization.find({ _id: { $in: orgIds } })
      .select('_id owner_id')
      .lean();

    const ownerIds = organizations
      .map((org) => org.owner_id?.toString())
      .filter((id): id is string => Boolean(id));

    const adminUsers = await User.find({
      organization_id: { $in: orgIds },
      is_active: true,
      $or: [{ role: 'admin' }, { _id: { $in: ownerIds } }]
    })
      .select('_id email display_name organization_id')
      .lean();

    const assigneeIds = [
      ...new Set(stages.flatMap((stage) => (stage.assignees || []).map(String)))
    ];
    const assigneeUsers = await User.find({ _id: { $in: assigneeIds }, is_active: true })
      .select('_id email display_name')
      .lean();

    const adminByOrganization = new Map<string, EmailUser[]>();
    for (const user of adminUsers) {
      const key = user.organization_id.toString();
      const list = adminByOrganization.get(key) || [];
      list.push(user);
      adminByOrganization.set(key, list);
    }
    const assigneeById = new Map(assigneeUsers.map((user) => [user._id.toString(), user]));

    for (const deal of deals) {
      if (!deal.stage_changed_at) continue;

      const stage = stageById.get(deal.stage_id?.toString() || '');
      if (!stage) continue;

      const isEscalation =
        !deal.stale_reminder_escalated_at && deal.stage_changed_at <= escalationCutoff;
      if (!isEscalation && deal.stale_reminder_sent_at) continue;

      const admins = adminByOrganization.get(stage.organization_id.toString()) || [];
      const assignees = (stage.assignees || [])
        .map(String)
        .map((id) => assigneeById.get(id))
        .filter(Boolean) as EmailUser[];

      const recipients = buildRecipients(assignees, admins);
      if (recipients.length === 0) continue;

      const stageChangedAt = new Date(deal.stage_changed_at);
      const daysInStage = Math.max(
        0,
        Math.floor((now.getTime() - stageChangedAt.getTime()) / (24 * 60 * 60 * 1000))
      );

      const contact = deal.contact_id as unknown as { first_name?: string; last_name?: string } | null;
      const company = deal.company_id as unknown as { name?: string } | null;
      const contactName = contact
        ? [contact.first_name || '', contact.last_name || ''].filter(Boolean).join(' ') || undefined
        : undefined;
      const companyName = company?.name;

      await sendStaleLeadReminderEmail(recipients, {
        dealTitle: deal.title,
        stageName: stage.name,
        daysInStage,
        contactName,
        companyName,
        escalation: isEscalation
      });

      const filter: Record<string, unknown> = { _id: deal._id };
      const update: Record<string, Date> = { stale_reminder_sent_at: new Date() };
      if (isEscalation) {
        filter.stale_reminder_escalated_at = null;
        update.stale_reminder_escalated_at = new Date();
      } else {
        filter.stale_reminder_sent_at = null;
      }
      await Deal.updateOne(filter, { $set: update });

      await Activity.create({
        type: 'stale_stage_reminder',
        content: `${deal.title} has been in ${stage.name} for ${daysInStage}+ days`,
        deal_id: deal._id,
        organization_id: stage.organization_id,
        metadata: {
          stage_id: stage._id,
          stage_name: stage.name,
          days_in_stage: daysInStage,
          escalation: isEscalation
        }
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to send stale deal reminders');
  } finally {
    isRunning = false;
  }
};

export const startStaleDealReminderService = (): void => {
  if (process.env.STALE_DEAL_REMINDERS_ENABLED === 'false') {
    logger.info('Stale deal reminder service disabled');
    return;
  }

  if (reminderTimer) return;

  const intervalMinutes = toPositiveNumber(
    process.env.STALE_REMINDER_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES
  );

  void sendStaleDealReminders();
  reminderTimer = setInterval(() => {
    void sendStaleDealReminders();
  }, intervalMinutes * 60 * 1000);

  logger.info(`Stale deal reminder service started; checking every ${intervalMinutes} minutes`);
};