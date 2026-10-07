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
 *     description: Bulk email to contacts through Amazon SES, with send history
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
 *   post:
 *     tags: [Broadcasts]
 *     summary: Create a draft (admin)
 *     description: Pass template_id to start from a template, or subject + html directly.
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
 *               template_id: { type: string }
 *               subject: { type: string }
 *               preview_text: { type: string }
 *               html: { type: string }
 *               audience:
 *                 $ref: '#/components/schemas/BroadcastAudience'
 * components:
 *   schemas:
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
 */
router.post('/audience/preview', previewAudience);

/**
 * @swagger
 * /broadcasts/{id}:
 *   get:
 *     tags: [Broadcasts]
 *     summary: Get a broadcast with html and stats
 *     security:
 *       - bearerAuth: []
 *   patch:
 *     tags: [Broadcasts]
 *     summary: Edit a draft or scheduled broadcast (admin)
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     tags: [Broadcasts]
 *     summary: Delete a draft (admin)
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', getBroadcast);
router.patch('/:id', MANAGE, updateBroadcast);
router.delete('/:id', MANAGE, deleteBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/send:
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
 */
router.post('/:id/send', MANAGE, sendBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/cancel:
 *   post:
 *     tags: [Broadcasts]
 *     summary: Cancel a scheduled or in-progress broadcast (admin)
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/cancel', MANAGE, cancelBroadcastHandler);

/**
 * @swagger
 * /broadcasts/{id}/test:
 *   post:
 *     tags: [Broadcasts]
 *     summary: Send the broadcast to yourself with sample merge data
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/test', MANAGE, sendTestBroadcast);

/**
 * @swagger
 * /broadcasts/{id}/recipients:
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
 */
router.get('/:id/recipients', listBroadcastRecipients);

export default router;
