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
 *     description: |
 *       User-configured automations — when a deal event happens, email a template to the deal's
 *       contact or owner. Emails are sent through **Ensend** by the background email dispatcher
 *       (throttled to EMAIL_MAX_SEND_RATE per second). If ENSEND_SECRET is not set, runs stay
 *       `scheduled` and nothing is sent.
 *
 *       **Common setups**
 *       - *Email when a new lead lands on the pipeline* — `event: deal.created` (optionally
 *         `pipeline_id`). Fires for deals created manually, added from the pipeline board, or
 *         captured from public lead forms.
 *       - *Email when a lead sits in a stage too long* — `event: deal.stage_entered` with
 *         `stage_id` and `delay_minutes` (e.g. 2880 = 2 days). When the send is due the deal is
 *         re-checked: if it has left that stage, the run is `skipped` and nothing is sent.
 *
 *       **Rules applied at send time** — a run is `skipped` when the trigger was paused or
 *       deleted, the deal was deleted, the deal left the stage (stage_entered), the deal value is
 *       below `min_deal_value`, the recipient has no email, or the contact has unsubscribed.
 *       A deal re-entering the same stage is not emailed twice by the same trigger.
 *       Contact emails include an unsubscribe link and use the deal owner as reply-to; the sender
 *       name is the organization name.
 *
 * components:
 *   schemas:
 *     EmailTriggerInput:
 *       type: object
 *       properties:
 *         name: { type: string, maxLength: 200, example: Proposal follow-up }
 *         event:
 *           type: string
 *           enum: [deal.stage_entered, deal.created, deal.won, deal.lost]
 *         stage_id:
 *           type: string
 *           nullable: true
 *           description: Required for deal.stage_entered, not allowed for other events. Also sets pipeline_id to the stage's pipeline.
 *         pipeline_id:
 *           type: string
 *           nullable: true
 *           description: Optional — limit deal.created / won / lost to one pipeline. Send null to clear.
 *         template_id: { type: string, description: An email template in your organization }
 *         recipient:
 *           type: string
 *           enum: [contact, deal_owner]
 *           default: contact
 *           description: contact = the deal's contact (honours unsubscribes); deal_owner = internal reminder to the owner
 *         delay_minutes:
 *           type: integer
 *           minimum: 0
 *           maximum: 129600
 *           default: 0
 *           description: Wait before sending (max 90 days). With deal.stage_entered this means "still in this stage after N minutes".
 *         min_deal_value:
 *           type: number
 *           minimum: 0
 *           nullable: true
 *           description: Only fire for deals worth at least this much. Send null to clear.
 *         is_active: { type: boolean, default: true, description: false pauses the trigger; its pending sends are skipped }
 *     EmailTriggerRef:
 *       type: object
 *       nullable: true
 *       properties:
 *         id: { type: string }
 *         name: { type: string, nullable: true }
 *     EmailTrigger:
 *       type: object
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         event: { type: string, enum: [deal.stage_entered, deal.created, deal.won, deal.lost] }
 *         pipeline: { $ref: '#/components/schemas/EmailTriggerRef' }
 *         stage: { $ref: '#/components/schemas/EmailTriggerRef' }
 *         template: { $ref: '#/components/schemas/EmailTriggerRef' }
 *         recipient: { type: string, enum: [contact, deal_owner] }
 *         delay_minutes: { type: integer }
 *         min_deal_value: { type: number, nullable: true }
 *         is_active: { type: boolean }
 *         sent_count: { type: integer, description: Emails sent by this trigger }
 *         last_fired_at: { type: string, format: date-time, nullable: true }
 *         created_at: { type: string, format: date-time }
 *         updated_at: { type: string, format: date-time }
 *     EmailTriggerRun:
 *       type: object
 *       description: One firing of a trigger for a deal (also its entry in the delayed-send queue)
 *       properties:
 *         id: { type: string }
 *         trigger: { $ref: '#/components/schemas/EmailTriggerRef' }
 *         deal:
 *           type: object
 *           nullable: true
 *           properties:
 *             id: { type: string }
 *             title: { type: string, nullable: true }
 *         stage: { $ref: '#/components/schemas/EmailTriggerRef' }
 *         event: { type: string, enum: [deal.stage_entered, deal.created, deal.won, deal.lost] }
 *         status:
 *           type: string
 *           enum: [scheduled, sending, sent, skipped, failed]
 *           description: scheduled = waiting for send_at (or for Ensend after a rate limit); sending = being handed to Ensend; sent = accepted by Ensend; skipped / failed — see error
 *         to_email: { type: string, nullable: true }
 *         subject: { type: string, nullable: true }
 *         error:
 *           type: string
 *           nullable: true
 *           example: Deal left the stage before the email was due
 *         send_at: { type: string, format: date-time }
 *         sent_at: { type: string, format: date-time, nullable: true }
 *         created_at: { type: string, format: date-time }
 *     EmailTriggerRunPage:
 *       type: object
 *       properties:
 *         status: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             data: { type: array, items: { $ref: '#/components/schemas/EmailTriggerRun' } }
 *             total: { type: integer }
 *             page: { type: integer }
 *             limit: { type: integer }
 *             total_pages: { type: integer }
 *     EmailTriggerValidationError:
 *       type: object
 *       properties:
 *         status: { type: boolean, example: false }
 *         message: { type: string, example: stage_id is required for deal.stage_entered triggers }
 *         errors: { type: array, items: { type: string } }
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
 *     responses:
 *       200:
 *         description: Triggers, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/EmailTrigger' } }
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
 *             allOf:
 *               - $ref: '#/components/schemas/EmailTriggerInput'
 *               - type: object
 *                 required: [name, event, template_id]
 *           examples:
 *             newLead:
 *               summary: Email a new lead when it lands on the pipeline
 *               value:
 *                 name: Welcome new lead
 *                 event: deal.created
 *                 pipeline_id: 665f1c2e9b1e8a0012345678
 *                 template_id: 665f1c2e9b1e8a0012345679
 *                 recipient: contact
 *             stuckInStage:
 *               summary: Email the lead if still in a stage after 2 days
 *               value:
 *                 name: Proposal follow-up after 2 days
 *                 event: deal.stage_entered
 *                 stage_id: 665f1c2e9b1e8a001234567a
 *                 template_id: 665f1c2e9b1e8a0012345679
 *                 recipient: contact
 *                 delay_minutes: 2880
 *             ownerReminder:
 *               summary: Remind the deal owner when a deal is stuck for 5 days
 *               value:
 *                 name: Stale deal reminder
 *                 event: deal.stage_entered
 *                 stage_id: 665f1c2e9b1e8a001234567a
 *                 template_id: 665f1c2e9b1e8a001234567b
 *                 recipient: deal_owner
 *                 delay_minutes: 7200
 *     responses:
 *       201:
 *         description: Trigger created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 message: { type: string, example: Trigger created }
 *                 data: { $ref: '#/components/schemas/EmailTrigger' }
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTriggerValidationError' }
 *       403: { description: Admins only }
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
 *     responses:
 *       200:
 *         description: Event list for the trigger builder UI
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       event: { type: string, example: deal.stage_entered }
 *                       label: { type: string, example: Deal enters a stage }
 *                       requires_stage: { type: boolean, example: true }
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
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50, maximum: 200 } }
 *     responses:
 *       200:
 *         description: Runs, newest first
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTriggerRunPage' }
 */
router.get('/runs', listTriggerRuns);

/**
 * @swagger
 * /email-triggers/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   get:
 *     tags: [Email Triggers]
 *     summary: Get a trigger
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The trigger
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/EmailTrigger' }
 *       400: { description: Invalid trigger ID }
 *       404: { description: Trigger not found }
 *   patch:
 *     tags: [Email Triggers]
 *     summary: Update a trigger, including is_active to pause/resume (admin)
 *     description: Send only the fields to change. Switching event away from deal.stage_entered clears the stage.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/EmailTriggerInput' }
 *           examples:
 *             pause:
 *               summary: Pause the trigger
 *               value: { is_active: false }
 *             changeDelay:
 *               summary: Wait 3 days instead
 *               value: { delay_minutes: 4320 }
 *     responses:
 *       200:
 *         description: Trigger updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 message: { type: string, example: Trigger updated }
 *                 data: { $ref: '#/components/schemas/EmailTrigger' }
 *       400:
 *         description: Invalid ID or validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTriggerValidationError' }
 *       403: { description: Admins only }
 *       404: { description: Trigger not found }
 *   delete:
 *     tags: [Email Triggers]
 *     summary: Delete a trigger; its pending sends are skipped (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Trigger deleted — its scheduled runs are marked skipped }
 *       400: { description: Invalid trigger ID }
 *       403: { description: Admins only }
 *       404: { description: Trigger not found }
 */
router.get('/:id', getTrigger);
router.patch('/:id', MANAGE, updateTrigger);
router.delete('/:id', MANAGE, deleteTrigger);

/**
 * @swagger
 * /email-triggers/{id}/runs:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   get:
 *     tags: [Email Triggers]
 *     summary: Send history for one trigger
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [scheduled, sending, sent, skipped, failed] } }
 *       - { in: query, name: deal_id, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 50, maximum: 200 } }
 *     responses:
 *       200:
 *         description: Runs, newest first
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTriggerRunPage' }
 *       400: { description: Invalid trigger ID }
 */
router.get('/:id/runs', listTriggerRuns);

export default router;
