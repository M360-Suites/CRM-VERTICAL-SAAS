import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  cancelBroadcastHandler,
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  listBroadcastRecipients,
  listBroadcasts,
  previewAudience,
  sendBroadcast,
  sendTestBroadcast,
  updateBroadcast
} from '../controllers/broadcastController';

const router: RouterType = Router();

/** Admins compose and send; everyone in the org can see history */
const MANAGE = authorize('admin');

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Broadcasts
 *     description: Bulk email to contacts through Ensend (batches of 250), with send history
 */

/**
 * @swagger
 * /broadcasts:
 *   get:
 *     tags: [Broadcasts]
 *     summary: Broadcast history, newest first
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [draft, scheduled, sending, sent, cancelled, failed] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Page of broadcasts (without html/design)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/Broadcast' } }
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total_pages: { type: integer }
 *   post:
 *     tags: [Broadcasts]
 *     summary: Create a draft (admin)
 *     description: |
 *       Only name is required, so the editor can save from the first edit. Subject and html are
 *       checked when the broadcast is sent or test-sent. Pass template_id to copy a template's
 *       subject, html, preview_text and design.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BroadcastInput'
 *     responses:
 *       201:
 *         description: Draft created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       400: { $ref: '#/components/responses/BroadcastError' }
 * components:
 *   responses:
 *     BroadcastError:
 *       description: 'Validation or state error: { status: false, message, errors? }'
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: boolean, example: false }
 *               message: { type: string }
 *               errors: { type: array, items: { type: string } }
 *   schemas:
 *     BroadcastInput:
 *       type: object
 *       properties:
 *         name: { type: string, maxLength: 200, description: Required on create }
 *         template_id: { type: string, nullable: true }
 *         subject: { type: string, maxLength: 300 }
 *         preview_text: { type: string, maxLength: 300, nullable: true }
 *         html: { type: string, maxLength: 500000 }
 *         design: { type: object, nullable: true, description: 'The editor JSON, stored as-is (max 500,000 chars). null clears it.' }
 *         audience:
 *           $ref: '#/components/schemas/BroadcastAudience'
 *     Broadcast:
 *       type: object
 *       description: The ID field is `id`, not `_id`. html and design are only included when a single broadcast is returned with its content (GET /broadcasts/{id}, POST, PATCH).
 *       properties:
 *         id: { type: string }
 *         name: { type: string }
 *         subject: { type: string, nullable: true }
 *         preview_text: { type: string, nullable: true }
 *         html: { type: string, nullable: true }
 *         design: { type: object, nullable: true }
 *         template_id: { type: string, nullable: true }
 *         audience: { $ref: '#/components/schemas/BroadcastAudience' }
 *         status: { type: string, enum: [draft, scheduled, sending, sent, cancelled, failed] }
 *         scheduled_at: { type: string, format: date-time, nullable: true }
 *         started_at: { type: string, format: date-time, nullable: true }
 *         completed_at: { type: string, format: date-time, nullable: true }
 *         stats:
 *           type: object
 *           properties:
 *             total: { type: integer }
 *             sent: { type: integer }
 *             failed: { type: integer }
 *             bounced: { type: integer }
 *             complained: { type: integer }
 *             skipped: { type: integer }
 *         error: { type: string, nullable: true }
 *         created_by:
 *           type: object
 *           nullable: true
 *           properties: { id: { type: string }, display_name: { type: string, nullable: true } }
 *         sent_by:
 *           type: object
 *           nullable: true
 *           properties: { id: { type: string }, display_name: { type: string, nullable: true } }
 *         created_at: { type: string, format: date-time }
 *         updated_at: { type: string, format: date-time }
 *     BroadcastResponse:
 *       type: object
 *       properties:
 *         status: { type: boolean, example: true }
 *         message: { type: string }
 *         data: { $ref: '#/components/schemas/Broadcast' }
 *     BroadcastAudience:
 *       type: object
 *       description: contact_ids wins if given; otherwise all, or every filter given must match (tags match any). Contacts without email or who unsubscribed are always excluded.
 *       properties:
 *         all: { type: boolean }
 *         tags: { type: array, items: { type: string } }
 *         temperature: { type: array, items: { type: string, enum: [hot, warm, cold] } }
 *         owner_ids: { type: array, items: { type: string } }
 *         company_ids: { type: array, items: { type: string } }
 *         contact_ids: { type: array, items: { type: string } }
 */
router.get('/', listBroadcasts);
router.post('/', MANAGE, createBroadcast);

/**
 * @swagger
 * /broadcasts/audience/preview:
 *   post:
 *     tags: [Broadcasts]
 *     summary: Count and sample the contacts an audience reaches
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               audience:
 *                 $ref: '#/components/schemas/BroadcastAudience'
 *     responses:
 *       200:
 *         description: 'data: { count, opted_out, sample: [{ id, name, email }] }; sample has up to 5 contacts'
 */
router.post('/audience/preview', previewAudience);

/**
 * @swagger
 * /broadcasts/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   get:
 *     tags: [Broadcasts]
 *     summary: Get a broadcast with html, design and stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The broadcast
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       404: { $ref: '#/components/responses/BroadcastError' }
 *   patch:
 *     tags: [Broadcasts]
 *     summary: Edit a draft or scheduled broadcast (admin)
 *     description: Send only the fields that changed. 409 once the broadcast is no longer a draft or scheduled.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/BroadcastInput' }
 *     responses:
 *       200:
 *         description: The updated broadcast
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       400: { $ref: '#/components/responses/BroadcastError' }
 *       409: { $ref: '#/components/responses/BroadcastError' }
 *   delete:
 *     tags: [Broadcasts]
 *     summary: Delete a draft (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: '{ status: true, message }' }
 *       409: { $ref: '#/components/responses/BroadcastError' }
 */
router.get('/:id', getBroadcast);
router.patch('/:id', MANAGE, updateBroadcast);
router.delete('/:id', MANAGE, deleteBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/send:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   post:
 *     tags: [Broadcasts]
 *     summary: Send now, or schedule with scheduled_at (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scheduled_at: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Scheduled (data is the broadcast without html/design)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       202:
 *         description: Sending started (data is the broadcast without html/design)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       400: { $ref: '#/components/responses/BroadcastError' }
 *       409: { $ref: '#/components/responses/BroadcastError' }
 *       503: { description: Ensend is not configured }
 */
router.post('/:id/send', MANAGE, sendBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/cancel:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   post:
 *     tags: [Broadcasts]
 *     summary: Cancel a scheduled or in-progress broadcast (admin)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cancelled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BroadcastResponse' }
 *       409: { $ref: '#/components/responses/BroadcastError' }
 */
router.post('/:id/cancel', MANAGE, cancelBroadcastHandler);

/**
 * @swagger
 * /broadcasts/{id}/test:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   post:
 *     tags: [Broadcasts]
 *     summary: Send a test with sample merge data (admin)
 *     description: Goes to you by default. Pass `to` to send it to up to 5 active members of your organization instead.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to:
 *                 type: array
 *                 maxItems: 5
 *                 items: { type: string, format: email }
 *     responses:
 *       200:
 *         description: 'data: { ensend_ref, sent_to: [emails] }'
 *       400: { $ref: '#/components/responses/BroadcastError' }
 */
router.post('/:id/test', MANAGE, sendTestBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/recipients:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *   get:
 *     tags: [Broadcasts]
 *     summary: Per-contact delivery history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [queued, sending, sent, failed, bounced, complained, skipped] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: 'data: { data: [{ id, contact_id, name, email, status, error, sent_at }], total, page, limit, total_pages }'
 */
router.get('/:id/recipients', listBroadcastRecipients);

export default router;
