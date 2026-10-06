import mongoose from 'mongoose';
import { Contact, IContact, RoutingMode } from '../models/Contact';
import { Deal } from '../models/Deal';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { RoutingRule } from '../models/RoutingRule';
import { AD_PLATFORMS, AdPlatform } from '../models/AdConnector';
import { emitNotification } from './socketService';
import { logger } from '../config/logger';

export const ROUTABLE_ROLES = ['sales_rep', 'sales_manager', 'admin'];

export interface LeadSignals {
  intent_score?: unknown;
  temperature?: string;
  region?: string;
  tier?: string;
  platform?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  gclid?: string;
  fbclid?: string;
  li_fat_id?: string;
  ttclid?: string;
}

const TEMPERATURE_SCORES: Record<string, number> = { hot: 80, warm: 50, cold: 25 };

/** Explicit 0–100 score wins; otherwise derived from temperature; default 50 */
export const scoreIntent = (signals: Pick<LeadSignals, 'intent_score' | 'temperature'>): number => {
  const explicit = Number(signals.intent_score);
  if (signals.intent_score !== undefined && signals.intent_score !== '' && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }
  return TEMPERATURE_SCORES[signals.temperature ?? ''] ?? 50;
};

const PAID_MEDIUMS = ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid_social', 'paidsocial', 'cpm', 'display'];

/** Work out which traffic source produced the lead from click IDs and UTM tags */
export const detectPlatform = (signals: LeadSignals): AdPlatform => {
  const explicit = signals.platform?.toLowerCase();
  if (explicit && (AD_PLATFORMS as readonly string[]).includes(explicit)) return explicit as AdPlatform;

  if (signals.gclid) return 'google_ads';
  if (signals.fbclid) return 'meta';
  if (signals.li_fat_id) return 'linkedin';
  if (signals.ttclid) return 'tiktok';

  const source = signals.utm_source?.toLowerCase() ?? '';
  const medium = signals.utm_medium?.toLowerCase() ?? '';
  if (source.includes('google') || source === 'adwords') {
    return PAID_MEDIUMS.includes(medium) ? 'google_ads' : 'seo';
  }
  if (['bing', 'duckduckgo', 'yahoo'].some((engine) => source.includes(engine)) && medium === 'organic') return 'seo';
  if (['facebook', 'instagram', 'meta', 'fb', 'ig'].includes(source)) return 'meta';
  if (source.includes('linkedin')) return 'linkedin';
  if (source.includes('tiktok')) return 'tiktok';

  return 'web_form';
};

export interface RuleLike {
  _id?: unknown;
  name: string;
  priority: number;
  region?: string | null;
  tier?: string | null;
  platform?: string | null;
  min_intent_score?: number | null;
  assignee_id?: unknown;
  is_active: boolean;
}

const sameText = (ruleValue?: string | null, leadValue?: string | null): boolean =>
  !ruleValue || (!!leadValue && ruleValue.trim().toLowerCase() === leadValue.trim().toLowerCase());

/**
 * First active rule (lowest priority number) whose region, tier, platform and
 * minimum intent score all match. Empty rule fields match anything.
 */
export const matchRoutingRule = <T extends RuleLike>(
  rules: T[],
  lead: { region?: string; tier?: string; platform?: string; intent_score: number }
): T | null =>
  [...rules]
    .filter((rule) => rule.is_active)
    .sort((a, b) => a.priority - b.priority)
    .find(
      (rule) =>
        sameText(rule.region, lead.region) &&
        sameText(rule.tier, lead.tier) &&
        (!rule.platform || rule.platform === lead.platform) &&
        lead.intent_score >= (rule.min_intent_score ?? 0)
    ) ?? null;

/** Active rep in the org with the fewest routed leads; ties broken randomly */
export const pickLeastLoadedRep = async (
  organizationId: mongoose.Types.ObjectId
): Promise<mongoose.Types.ObjectId | null> => {
  const reps = await User.find({ organization_id: organizationId, is_active: true, role: { $in: ROUTABLE_ROLES } })
    .select('_id')
    .lean();
  if (reps.length === 0) return null;

  const loads = await Contact.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    {
      $match: {
        organization_id: organizationId,
        owner_id: { $in: reps.map((rep) => rep._id) },
        'routing.routed_at': { $exists: true }
      }
    },
    { $group: { _id: '$owner_id', count: { $sum: 1 } } }
  ]);
  const loadByRep = new Map(loads.map((load) => [load._id.toString(), load.count]));

  const ranked = reps
    .map((rep) => ({ id: rep._id as mongoose.Types.ObjectId, load: loadByRep.get(rep._id.toString()) ?? 0, tie: Math.random() }))
    .sort((a, b) => a.load - b.load || a.tie - b.tie);
  return ranked[0].id;
};

const isActiveRep = async (organizationId: mongoose.Types.ObjectId, userId: unknown): Promise<boolean> =>
  !!userId &&
  !!(await User.exists({ _id: userId, organization_id: organizationId, is_active: true, role: { $in: ROUTABLE_ROLES } }));

export interface RoutingOutcome {
  owner_id: mongoose.Types.ObjectId | null;
  rule_name: string | null;
  mode: RoutingMode;
  intent_score: number;
  platform: AdPlatform;
}

/**
 * The Revenue Engine lead pipeline, run inline right after a lead is captured:
 * score → match rule → assign owner (rule assignee, else least-loaded rep) →
 * stamp routing on the contact → notify owner. Notification is best effort;
 * routing never fails capture.
 */
export const routeNewLead = async (
  contact: IContact,
  signals: LeadSignals,
  options: { dealId?: mongoose.Types.ObjectId | null } = {}
): Promise<RoutingOutcome> => {
  const organizationId = contact.organization_id;
  const intentScore = scoreIntent(signals);
  const platform = detectPlatform(signals);

  const rules = await RoutingRule.find({ organization_id: organizationId, is_active: true })
    .sort({ priority: 1, created_at: 1 })
    .lean();
  const rule = matchRoutingRule(rules, { region: signals.region, tier: signals.tier, platform, intent_score: intentScore });

  let ownerId: mongoose.Types.ObjectId | null = (contact.owner_id as mongoose.Types.ObjectId | undefined) ?? null;
  if (!ownerId && rule?.assignee_id && (await isActiveRep(organizationId, rule.assignee_id))) {
    ownerId = rule.assignee_id as mongoose.Types.ObjectId;
  }
  if (!ownerId) ownerId = await pickLeastLoadedRep(organizationId);

  const mode: RoutingMode = rule ? 'rule' : ownerId ? 'balanced' : 'unassigned';
  const routing = {
    intent_score: intentScore,
    region: signals.region,
    tier: signals.tier,
    platform,
    source: signals.source,
    rule_id: rule?._id as mongoose.Types.ObjectId | undefined,
    rule_name: rule?.name,
    mode,
    routed_at: new Date()
  };

  await Contact.updateOne(
    { _id: contact._id, organization_id: organizationId },
    { $set: { routing, ...(ownerId ? { owner_id: ownerId } : {}) } }
  );
  if (ownerId && options.dealId) {
    await Deal.updateOne(
      { _id: options.dealId, organization_id: organizationId, owner_id: { $exists: false } },
      { $set: { owner_id: ownerId } }
    );
  }

  const leadName = `${contact.first_name} ${contact.last_name}`.trim() || contact.email || 'Unknown lead';

  if (ownerId) {
    try {
      const title = `New lead assigned: ${leadName}`;
      await Notification.create({
        userId: ownerId,
        provider: 'internal',
        type: 'new_lead',
        title,
        metadata: {
          contact_id: contact._id.toString(),
          deal_id: options.dealId?.toString() ?? null,
          intent_score: intentScore,
          rule: rule?.name ?? null,
          link: '/revenue-engine'
        }
      });
      emitNotification(ownerId.toString(), { provider: 'internal', title, createdAt: new Date() });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to notify routed lead owner');
    }
  }

  return { owner_id: ownerId, rule_name: rule?.name ?? null, mode, intent_score: intentScore, platform };
};
