import { Router, type Router as RouterType } from 'express';
import { listSocialAccounts, connectSocialAccount, disconnectSocialAccount, handleConnectCallback } from '../controllers/socialAccountController';
import { authenticate } from '../middleware/auth';

const router: RouterType = Router();

/**
 * @swagger
 * /social-accounts/callback:
 *   get:
 *     summary: Handle Unipile hosted auth redirect callback
 *     description: Creates SocialAccount record from Unipile redirect query params and redirects to frontend.
 *     tags: [Social Accounts]
 *     parameters:
 *       - in: query
 *         name: account_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *       - in: query
 *         name: error_type
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirects to frontend with status
 */
router.get('/callback', handleConnectCallback);

router.use(authenticate);

/**
 * @swagger
 * /social-accounts:
 *   get:
 *     summary: List connected social accounts
 *     tags: [Social Accounts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Social accounts retrieved successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SocialAccount'
 */
router.get('/', listSocialAccounts);

/**
 * @swagger
 * /social-accounts/connect/{provider}:
 *   post:
 *     summary: Generate connect URL for a social provider
 *     tags: [Social Accounts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [whatsapp, instagram, facebook]
 *     responses:
 *       200:
 *         description: Connect URL generated successfully
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
 *                     url:
 *                       type: string
 *       400:
 *         description: Invalid provider
 */
router.post('/connect/:provider', connectSocialAccount);

/**
 * @swagger
 * /social-accounts/{accountId}:
 *   delete:
 *     summary: Disconnect a social account
 *     tags: [Social Accounts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Social account disconnected successfully
 *       404:
 *         description: Social account not found
 */
router.delete('/:accountId', disconnectSocialAccount);

export default router;
