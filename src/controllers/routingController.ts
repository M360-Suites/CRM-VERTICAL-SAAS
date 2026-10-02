import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { RoutingRule } from '../models/RoutingRule';
import { AD_PLATFORMS } from '../models/AdConnector';
import { Contact } from '../models/Contact';
import { User } from '../models/User';
import { requireOrganization } from '../utils/tenant';
import { recordWarehouseEvent } from '../utils/warehouse';
import { optionalEnum, optionalNumber, optionalObjectId, optionalString, parsePaging } from '../utils/revopsInput';
import { ROUTABLE_ROLES, matchRoutingRule } from '../services/leadRoutingService';
import { logger } from '../config/logger';

const handleError = (res: Response, error: unknown, message: string): void => {
  logger.error({ err: error }, message);
  res.status(500).json({ status: false, message });
};

type RuleInput = {
  name?: string;
  priority?: number;
  region?: string | null;
  tier?: string | null;
  platform?: string | null;
  min_intent_score?: number;
  assignee_id?: mongoose.Types.ObjectId | null;
  is_active?: boolean;
};

/**
 * Parse a rule body. `partial` allows omitted fields (PATCH). Empty strings
 * clear optional match fields; assignee_id '' / null means least-loaded rep.
 */
const parseRuleInput = async (
  organizationId: mongoose.Types.ObjectId,
  body: Record<string, unknown>,
  partial: boolean
): Promise<{ input: RuleInput; errors: string[] }> => {
  const errors: string[] = [];
  const input: RuleInput = {};

  const name = optionalString(body.name, 120);
  if (name === null || (!partial && !name)) errors.push('name is required (max 120 chars)');
  else if (name) input.name = name;

  const priority = optionalNumber(body.priority, 0, 100_000);
  if (priority === null) errors.push('priority must be a number between 0 and 100000');
  else if (priority !== undefined) input.priority = Math.floor(priority);

  const minScore = optionalNumber(body.min_intent_score, 0, 100);
  if (minScore === null) errors.push('min_intent_score must be between 0 and 100');
  else if (minScore !== undefined) input.min_intent_score = Math.floor(minScore);

  for (const field of ['region', 'tier'] as const) {
    if (!(field in body)) continue;
    const value = optionalString(body[field], 80);
    if (value === null) errors.push(`${field} is invalid`);
    else input[field] = value ?? null;
  }

  if ('platform' in body) {
    const platform = optionalEnum(body.platform, AD_PLATFORMS);
    if (platform === null) errors.push('platform is invalid');
    else input.platform = platform ?? null;
  }

  if ('assignee_id' in body) {
    const assigneeId = optionalObjectId(body.assignee_id);
    if (assigneeId === null) {
      errors.push('assignee_id is invalid');
    } else if (assigneeId) {
      const exists = await User.exists({
        _id: assigneeId,
        organization_id: organizationId,
        is_active: true,
        role: { $in: ROUTABLE_ROLES }
      });
      if (!exists) errors.push('assignee_id must be an active rep in your organization');
      else input.assignee_id = assigneeId;
    } else {
      input.assignee_id = null;
    }
  }

  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') errors.push('is_active must be a boolean');
    else input.is_active = body.is_active;
  }

  return { input, errors };
};

/** Mongo update: null clears an optional field */
const toUpdate = (input: RuleInput) => {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null) $unset[key] = 1;
    else if (value !== undefined) $set[key] = value;
  }
  return { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) };
};

const serializeRule = (rule: any) => ({
  id: rule._id,
  name: rule.name,
  priority: rule.priority,
  region: rule.region ?? null,
  tier: rule.tier ?? null,
  platform: rule.platform ?? null,
  min_intent_score: rule.min_intent_score ?? 0,
  is_active: rule.is_active,
  assignee: rule.assignee_id
    ? { id: rule.assignee_id._id ?? rule.assignee_id, display_name: rule.assignee_id.display_name ?? null }
    : null,
  created_at: rule.created_at,
  updated_at: rule.updated_at
});

/**
 * GET /revops/routing-rules — ordered by priority (lower runs first)
 */
export const listRules = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const rules = await RoutingRule.find({ organization_id: organizationId })
      .sort({ priority: 1, created_at: 1 })
      .populate('assignee_id', 'display_name')
      .lean();
    res.json({ status: true, data: rules.map(serializeRule) });
  } catch (error) {
    handleError(res, error, 'Failed to load routing rules');
  }
};

/**
 * POST /revops/routing-rules
 */
export const createRule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { input, errors } = await parseRuleInput(organizationId, req.body ?? {}, false);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }

    const rule = await RoutingRule.create({
      organization_id: organizationId,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined))
    });

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'routing_rule_created',
      entityType: 'routing_rule',
      entityId: rule._id as mongoose.Types.ObjectId,
      actorId: req.user?.id,
      payload: { name: rule.name, priority: rule.priority }
    });

    const populated = await RoutingRule.findById(rule._id).populate('assignee_id', 'display_name').lean();
    res.status(201).json({ status: true, message: 'Routing rule created', data: serializeRule(populated) });
  } catch (error) {
    handleError(res, error, 'Failed to create routing rule');
  }
};

/**
 * PATCH /revops/routing-rules/:id — any rule field, including is_active (pause/resume)
 */
export const updateRule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const ruleId = optionalObjectId(req.params.id);
    if (!ruleId) {
      res.status(404).json({ status: false, message: 'Routing rule not found' });
      return;
    }

    const { input, errors } = await parseRuleInput(organizationId, req.body ?? {}, true);
    if (errors.length) {
      res.status(400).json({ status: false, message: 'Validation failed', errors });
      return;
    }

    const rule = await RoutingRule.findOneAndUpdate({ _id: ruleId, organization_id: organizationId }, toUpdate(input), {
      new: true
    })
      .populate('assignee_id', 'display_name')
      .lean();
    if (!rule) {
      res.status(404).json({ status: false, message: 'Routing rule not found' });
      return;
    }

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'routing_rule_updated',
      entityType: 'routing_rule',
      entityId: ruleId,
      actorId: req.user?.id,
      payload: { fields: Object.keys(input), is_active: rule.is_active }
    });

    res.json({ status: true, message: 'Routing rule updated', data: serializeRule(rule) });
  } catch (error) {
    handleError(res, error, 'Failed to update routing rule');
  }
};

/**
 * DELETE /revops/routing-rules/:id
 */
export const deleteRule = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const ruleId = optionalObjectId(req.params.id);
    const rule = ruleId ? await RoutingRule.findOneAndDelete({ _id: ruleId, organization_id: organizationId }) : null;
    if (!rule) {
      res.status(404).json({ status: false, message: 'Routing rule not found' });
      return;
    }

    await recordWarehouseEvent({
      organizationId,
      source: 'uroe',
      eventType: 'routing_rule_deleted',
      entityType: 'routing_rule',
      entityId: rule._id as mongoose.Types.ObjectId,
      actorId: req.user?.id,
      payload: { name: rule.name }
    });

    res.json({ status: true, message: 'Routing rule deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete routing rule');
  }
};

/**
 * POST /revops/routing-rules/simulate — body { region?, tier?, intent_score?, platform? }
 * Dry run: which rule (and rep) a lead with these signals would hit. Writes nothing.
 */
export const simulateRouting = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const body = req.body ?? {};
    const score = optionalNumber(body.intent_score, 0, 100);
    const platform = optionalEnum(body.platform, AD_PLATFORMS);
    const region = optionalString(body.region, 80);
    const tier = optionalString(body.tier, 80);
    if (score === null || platform === null || region === null || tier === null) {
      res.status(400).json({ status: false, message: 'Invalid simulation input' });
      return;
    }

    const rules = await RoutingRule.find({ organization_id: organizationId, is_active: true })
      .sort({ priority: 1, created_at: 1 })
      .populate('assignee_id', 'display_name')
      .lean();
    const match = matchRoutingRule(rules, {
      region: region ?? undefined,
      tier: tier ?? undefined,
      platform: platform ?? undefined,
      intent_score: score ?? 50
    });

    const assignee = match?.assignee_id as unknown as { _id: mongoose.Types.ObjectId; display_name?: string } | undefined;

    res.json({
      status: true,
      data: {
        matched: !!match,
        rule: match ? serializeRule(match) : null,
        assignee: assignee ? { id: assignee._id, display_name: assignee.display_name ?? null } : null,
        outcome: match
          ? `Routed to ${assignee?.display_name ?? 'the least-loaded rep'} via "${match.name}"`
          : 'No matching rule — lead goes to the least-loaded rep'
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to simulate routing');
  }
};

/**
 * GET /revops/routed-leads — most recently auto-routed leads
 * Query: page, limit (default 12)
 */
export const listRoutedLeads = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const { page, limit, skip } = parsePaging(req.query as Record<string, unknown>, 12, 100);
    const filter = { organization_id: organizationId, 'routing.routed_at': { $exists: true } };

    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .sort({ 'routing.routed_at': -1 })
        .skip(skip)
        .limit(limit)
        .select('first_name last_name email routing owner_id created_at')
        .populate('owner_id', 'display_name')
        .lean(),
      Contact.countDocuments(filter)
    ]);

    res.json({
      status: true,
      data: contacts.map((contact) => {
        const owner = contact.owner_id as unknown as { _id: mongoose.Types.ObjectId; display_name?: string } | undefined;
        return {
          contact_id: contact._id,
          name: `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
          email: contact.email ?? null,
          source: contact.routing?.source ?? contact.routing?.platform ?? null,
          platform: contact.routing?.platform ?? null,
          intent_score: contact.routing?.intent_score ?? null,
          rule_name: contact.routing?.rule_name ?? null,
          routing_mode: contact.routing?.mode ?? null,
          owner: owner ? { id: owner._id, display_name: owner.display_name ?? null } : null,
          routed_at: contact.routing?.routed_at ?? contact.created_at
        };
      }),
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    handleError(res, error, 'Failed to load routed leads');
  }
};

/**
 * GET /revops/reps — active users that can own leads (for assignee pickers)
 */
export const listReps = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const reps = await User.find({ organization_id: organizationId, is_active: true, role: { $in: ROUTABLE_ROLES } })
      .select('display_name role')
      .sort({ display_name: 1 })
      .lean();
    res.json({
      status: true,
      data: reps.map((rep) => ({ id: rep._id, display_name: rep.display_name, role: rep.role }))
    });
  } catch (error) {
    handleError(res, error, 'Failed to load reps');
  }
};
