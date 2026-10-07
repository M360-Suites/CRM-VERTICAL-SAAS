import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  createTrigger,
  deleteTrigger,
  getTrigger,
  listTriggerEvents,
  listTriggerRuns,
  listTriggers,
  updateTrigger
} from '../controllers/emailTriggerController';

const router: RouterType = Router();

/** Admins configure triggers; everyone in the org can read */
const MANAGE = authorize('admin');

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Email Triggers
 *     description: User-configured automations — when a deal event happens, send a template
 */

/**
 * @swagger
 * /email-triggers:
 *   get:
 *     tags: [Email Triggers]
 *     summary: List triggers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: event, schema: { type: string, enum: [deal.stage_entered, deal.created, deal.won, deal.lost] } }
 *       - { in: query, name: stage_id, schema: { type: string } }
 *   post:
 *     tags: [Email Triggers]
 *     summary: Create a trigger (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, event, template_id]
 *             properties:
 *               name: { type: string, example: Proposal follow-up }
 *               event: { type: string, enum: [deal.stage_entered, deal.created, deal.won, deal.lost] }
 *               stage_id: { type: string, description: Required for deal.stage_entered }
 *               pipeline_id: { type: string, description: Optional — limit created/won/lost to one pipeline }
 *               template_id: { type: string }
 *               recipient: { type: string, enum: [contact, deal_owner], default: contact }
 *               delay_minutes: { type: integer, minimum: 0, maximum: 129600, default: 0 }
 *               min_deal_value: { type: number }
 *               is_active: { type: boolean, default: true }
 */
router.get('/', listTriggers);
router.post('/', MANAGE, createTrigger);

/**
 * @swagger
 * /email-triggers/events:
 *   get:
 *     tags: [Email Triggers]
 *     summary: Events a trigger can listen for
 *     security:
 *       - bearerAuth: []
 */
router.get('/events', listTriggerEvents);

/**
 * @swagger
 * /email-triggers/runs:
 *   get:
 *     tags: [Email Triggers]
 *     summary: Send history across all triggers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [scheduled, sending, sent, skipped, failed] } }
 *       - { in: query, name: deal_id, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 */
router.get('/runs', listTriggerRuns);

/**
 * @swagger
 * /email-triggers/{id}:
 *   get:
 *     tags: [Email Triggers]
 *     summary: Get a trigger
 *     security:
 *       - bearerAuth: []
 *   patch:
 *     tags: [Email Triggers]
 *     summary: Update a trigger, including is_active to pause/resume (admin)
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     tags: [Email Triggers]
 *     summary: Delete a trigger; its pending sends are skipped (admin)
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', getTrigger);
router.patch('/:id', MANAGE, updateTrigger);
router.delete('/:id', MANAGE, deleteTrigger);

/**
 * @swagger
 * /email-triggers/{id}/runs:
 *   get:
 *     tags: [Email Triggers]
 *     summary: Send history for one trigger
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/runs', listTriggerRuns);

export default router;
