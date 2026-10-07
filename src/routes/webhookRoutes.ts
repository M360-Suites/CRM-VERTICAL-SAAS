import { Router, type Router as RouterType } from 'express';
import { handleUnipileWebhook } from '../controllers/unipileWebhookController';
import { handleSesWebhook } from '../controllers/emailEventsController';

const router: RouterType = Router();

/**
 * @swagger
 * /webhooks/unipile:
 *   post:
 *     summary: Receive Unipile webhook events
 *     description: External webhook endpoint for Unipile social messaging events. Validates HMAC signature and creates notifications for new messages.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 example: message.received
 *               account_id:
 *                 type: string
 *               accountId:
 *                 type: string
 *               sender_name:
 *                 type: string
 *               from:
 *                 type: string
 *               sender:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook acknowledged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                   example: true
 */
router.post('/unipile', handleUnipileWebhook);

/**
 * @swagger
 * /api/webhooks/ses:
 *   post:
 *     tags: [Broadcasts]
 *     summary: Amazon SNS endpoint for SES bounce and complaint events
 *     description: Signature-verified. Hard bounces and complaints opt the contact out of further email.
 */
router.post('/ses', handleSesWebhook);

export default router;
