import { Router, type Router as RouterType, type Response, type NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getOrganizationObjectId } from '../utils/tenant';
import { ensureRevopsDefaults } from '../services/revopsDefaults';
import {
  deleteCampaignRow,
  getCosts,
  getOverview,
  listCampaignRows,
  listConnectors,
  listTargets,
  logCampaignSpend,
  updateConnectorStatus,
  updateTarget
} from '../controllers/revopsController';
import {
  createRule,
  deleteRule,
  listReps,
  listRoutedLeads,
  listRules,
  simulateRouting,
  updateRule
} from '../controllers/routingController';
const router: RouterType = Router();

/** Managers configure the engine; everyone in the org can read */
const MANAGE = authorize('admin', 'sales_manager');

router.use(authenticate);

/** First touch of the Revenue Engine seeds the org's connectors and targets */
router.use(async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const organizationId = getOrganizationObjectId(req);
  if (organizationId) await ensureRevopsDefaults(organizationId);
  next();
});

/**
 * @swagger
 * tags:
 *   - name: Revenue Ops
 *     description: Revenue Engine — CRO dashboard, connectors, cost, routing
 */

/* ---- 1. CRO Dashboard ---- */

/**
 * @swagger
 * /revops/overview:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: CRO dashboard KPIs
 *     description: Spend, revenue, ROAS, CAC, win rate, cycle length, CPC, cost per lead, spend vs revenue by platform, and executive targets. All-time unless from/to given.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, example: 2026-09-01 } }
 *       - { in: query, name: to, schema: { type: string, example: 2026-09-30 } }
 */
router.get('/overview', getOverview);

/**
 * @swagger
 * /revops/targets:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Executive KPI targets
 *     security:
 *       - bearerAuth: []
 */
router.get('/targets', listTargets);

/**
 * @swagger
 * /revops/targets/{key}:
 *   put:
 *     tags: [Revenue Ops]
 *     summary: Update a KPI target (admin, sales_manager)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string, enum: [ad_cost, revenue, roas, cac, cycle_days] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [target_value]
 *             properties:
 *               target_value: { type: number }
 *               label: { type: string }
 *               unit: { type: string }
 */
router.put('/targets/:key', MANAGE, updateTarget);

/* ---- 2. Ad Connectors ---- */

/**
 * @swagger
 * /revops/connectors:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Traffic-source connectors with campaign count and tracked spend
 *     security:
 *       - bearerAuth: []
 */
router.get('/connectors', listConnectors);

/**
 * @swagger
 * /revops/connectors/{id}/status:
 *   patch:
 *     tags: [Revenue Ops]
 *     summary: Mark a manual connector connected / disconnected / error (admin, sales_manager)
 *     description: Google Ads is OAuth-only — use /integrations/google-ads.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [connected, disconnected, error] }
 */
router.patch('/connectors/:id/status', MANAGE, updateConnectorStatus);

/* ---- 3. Cost Intelligence ---- */

/**
 * @swagger
 * /revops/costs:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Spend, CPC, CTR, CPM and cost per conversion by platform, campaign and day
 *     description: Defaults to the last 30 days.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *       - { in: query, name: platform, schema: { type: string } }
 */
router.get('/costs', getCosts);

/**
 * @swagger
 * /revops/campaigns:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Spend ledger (one row per campaign/ad set/creative/day)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 500 } }
 *       - { in: query, name: platform, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string } }
 *       - { in: query, name: to, schema: { type: string } }
 *   post:
 *     tags: [Revenue Ops]
 *     summary: Log a day of campaign spend (admin, sales_manager)
 *     description: Upserts on (platform, campaign, ad set, creative, date) — logging the same day twice overwrites.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [platform, name, stat_date]
 *             properties:
 *               platform: { type: string }
 *               name: { type: string }
 *               stat_date: { type: string, example: 2026-10-01 }
 *               external_campaign_id: { type: string }
 *               adset_id: { type: string }
 *               creative_id: { type: string }
 *               spend: { type: number }
 *               impressions: { type: integer }
 *               clicks: { type: integer }
 *               currency: { type: string, example: USD }
 */
router.get('/campaigns', listCampaignRows);
router.post('/campaigns', MANAGE, logCampaignSpend);

/**
 * @swagger
 * /revops/campaigns/{id}:
 *   delete:
 *     tags: [Revenue Ops]
 *     summary: Delete a spend row (admin, sales_manager)
 *     security:
 *       - bearerAuth: []
 */
router.delete('/campaigns/:id', MANAGE, deleteCampaignRow);

/* ---- 4. Instant Routing ---- */

/**
 * @swagger
 * /revops/routing-rules:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Routing rules, lowest priority number first
 *     security:
 *       - bearerAuth: []
 *   post:
 *     tags: [Revenue Ops]
 *     summary: Create a routing rule (admin, sales_manager)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               priority: { type: integer, default: 100 }
 *               region: { type: string, example: EMEA }
 *               tier: { type: string, example: Enterprise }
 *               platform: { type: string }
 *               min_intent_score: { type: integer, minimum: 0, maximum: 100 }
 *               assignee_id: { type: string, description: Empty for least-loaded rep }
 */
router.get('/routing-rules', listRules);
router.post('/routing-rules', MANAGE, createRule);

/**
 * @swagger
 * /revops/routing-rules/simulate:
 *   post:
 *     tags: [Revenue Ops]
 *     summary: Dry-run which rule a lead would match (writes nothing)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               region: { type: string }
 *               tier: { type: string }
 *               intent_score: { type: integer }
 *               platform: { type: string }
 */
router.post('/routing-rules/simulate', simulateRouting);

/**
 * @swagger
 * /revops/routing-rules/{id}:
 *   patch:
 *     tags: [Revenue Ops]
 *     summary: Update a rule, including is_active to pause/resume (admin, sales_manager)
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     tags: [Revenue Ops]
 *     summary: Delete a rule (admin, sales_manager)
 *     security:
 *       - bearerAuth: []
 */
router.patch('/routing-rules/:id', MANAGE, updateRule);
router.delete('/routing-rules/:id', MANAGE, deleteRule);

/**
 * @swagger
 * /revops/routed-leads:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Recently auto-routed leads with score, rule and owner
 *     security:
 *       - bearerAuth: []
 */
router.get('/routed-leads', listRoutedLeads);

/**
 * @swagger
 * /revops/reps:
 *   get:
 *     tags: [Revenue Ops]
 *     summary: Active users who can own leads (assignee picker)
 *     security:
 *       - bearerAuth: []
 */
router.get('/reps', listReps);

export default router;
