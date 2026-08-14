import { Router, type Router as RouterType } from 'express';
import {
  getAnalytics,
  getAnalyticsLeadSources,
  getAnalyticsPipelineByStage,
  getAnalyticsSummary,
  getAnalyticsTaskSummary,
  getAnalyticsTeamProductivity
} from '../controllers/analyticsController';
import { authenticate } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Analytics
 *     description: Business performance analytics
 */

/**
 * @swagger
 * /analytics:
 *   get:
 *     summary: Get complete analytics board data
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *         description: Shortcut time range. daily = today, weekly = this week (from Monday), monthly = this month.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (overrides timeframe).
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (overrides timeframe).
 *     responses:
 *       200:
 *         description: Analytics board data
 */
router.get('/', getAnalytics);

/**
 * @swagger
 * /analytics/summary:
 *   get:
 *     summary: Get analytics summary KPIs
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Analytics summary
 */
router.get('/summary', getAnalyticsSummary);

/**
 * @swagger
 * /analytics/pipeline-by-stage:
 *   get:
 *     summary: Get deal count and value by stage
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Pipeline analytics by stage
 */
router.get('/pipeline-by-stage', getAnalyticsPipelineByStage);

/**
 * @swagger
 * /analytics/lead-sources:
 *   get:
 *     summary: Get lead source counts
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Lead sources
 */
router.get('/lead-sources', getAnalyticsLeadSources);

/**
 * @swagger
 * /analytics/team-productivity:
 *   get:
 *     summary: Get task productivity by team member
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Team productivity
 */
router.get('/team-productivity', getAnalyticsTeamProductivity);

/**
 * @swagger
 * /analytics/task-summary:
 *   get:
 *     summary: Get total task numbers
 *     tags: [Analytics]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [daily, weekly, monthly]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Task summary
 */
router.get('/task-summary', getAnalyticsTaskSummary);

export default router;
