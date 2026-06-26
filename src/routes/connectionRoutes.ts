import { Router, type Router as RouterType } from 'express';
import { getConnectionStatuses } from '../controllers/connectionController';
import { authenticate } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /connections/status:
 *   get:
 *     summary: Get all social connection statuses
 *     description: Returns the connection status for Gmail, WhatsApp, Instagram, and Facebook for the authenticated user.
 *     tags: [Connections]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection statuses retrieved successfully
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
 *                     gmail:
 *                       type: object
 *                       properties:
 *                         connected:
 *                           type: boolean
 *                         gmail_sync_enabled:
 *                           type: boolean
 *                         last_sync_at:
 *                           type: string
 *                           nullable: true
 *                         synced_count:
 *                           type: integer
 *                     whatsapp:
 *                       type: object
 *                       properties:
 *                         connected:
 *                           type: boolean
 *                         accountId:
 *                           type: string
 *                         status:
 *                           type: string
 *                         connectedAt:
 *                           type: string
 *                     instagram:
 *                       type: object
 *                       properties:
 *                         connected:
 *                           type: boolean
 *                         accountId:
 *                           type: string
 *                         status:
 *                           type: string
 *                         connectedAt:
 *                           type: string
 *                     facebook:
 *                       type: object
 *                       properties:
 *                         connected:
 *                           type: boolean
 *                         accountId:
 *                           type: string
 *                         status:
 *                           type: string
 *                         connectedAt:
 *                           type: string
 */
router.get('/status', getConnectionStatuses);

export default router;
