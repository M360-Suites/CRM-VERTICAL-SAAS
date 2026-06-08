import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getGmailAuthUrl,
  handleGmailCallback,
  syncGmailInbox,
  disconnectGmail,
  listSyncedMessages,
  createContactFromSender,
  linkMessageToContact,
  gmailStatus,
} from '../controllers/emailSyncController';

const router: RouterType = Router();

/**
 * @swagger
 * /email/auth:
 *   get:
 *     summary: Get Gmail OAuth authorization URL
 *     description: Generates a Gmail OAuth URL for the authenticated user and current organization.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Auth URL generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 */
router.get('/auth', authenticate, getGmailAuthUrl);

/**
 * @swagger
 * /email/auth/callback:
 *   get:
 *     summary: Handle Gmail OAuth callback
 *     description: Stores encrypted Gmail tokens for the user and redirects to the frontend with gmail=connected.
 *     tags: [Email Sync]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend
 */
router.get('/auth/callback', handleGmailCallback);

/**
 * @swagger
 * /email/status:
 *   get:
 *     summary: Get Gmail connection status
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Gmail sync status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                     gmail_sync_enabled:
 *                       type: boolean
 *                     last_sync_at:
 *                       type: string
 *                       nullable: true
 *                     synced_count:
 *                       type: integer
 */
router.get('/status', authenticate, gmailStatus);

/**
 * @swagger
 * /email/sync:
 *   post:
 *     summary: Trigger Gmail inbox sync (fetches last 25 messages)
 *     description: Syncs Gmail metadata into the authenticated user's organization.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     synced:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     linked:
 *                       type: integer
 *       401:
 *         description: Gmail not connected
 */
router.post('/sync', authenticate, syncGmailInbox);

/**
 * @swagger
 * /email/auth/disconnect:
 *   delete:
 *     summary: Disconnect Gmail
 *     description: Revokes Gmail access when possible, clears stored Gmail tokens, and disables Gmail sync for the authenticated user.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Gmail disconnected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     channel:
 *                       type: string
 *                       example: gmail
 *                     connected:
 *                       type: boolean
 *                     gmail_sync_enabled:
 *                       type: boolean
 *             example:
 *               status: true
 *               message: Gmail disconnected successfully
 *               data:
 *                 connected: false
 *                 gmail_sync_enabled: false
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to disconnect Gmail
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/auth/disconnect', authenticate, disconnectGmail);

/**
 * @swagger
 * /email/messages:
 *   get:
 *     summary: List synced email messages
 *     description: Lists Gmail messages scoped to the authenticated user and organization.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: List of synced messages
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmailMessagePaginatedResponse'
 */
router.get('/messages', authenticate, listSyncedMessages);

/**
 * @swagger
 * /email/messages/{messageId}/create-contact:
 *   post:
 *     summary: Create a contact from an unknown email sender
 *     description: Creates or links a contact inside the authenticated user's organization.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Contact created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     contact:
 *                       $ref: '#/components/schemas/Contact'
 *       400:
 *         description: Sender already linked
 *       404:
 *         description: Message not found
 */
router.post('/messages/:messageId/create-contact', authenticate, createContactFromSender);

/**
 * @swagger
 * /email/messages/{messageId}/link:
 *   post:
 *     summary: Link a message to an existing contact
 *     description: The target message and contact must belong to the authenticated user's organization.
 *     tags: [Email Sync]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contactId]
 *             properties:
 *               contactId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message linked
 *       404:
 *         description: Message or contact not found
 */
router.post('/messages/:messageId/link', authenticate, linkMessageToContact);

export default router;
