import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  getApiKeys,
  regeneratePublicKey,
  regenerateSecretKey
} from '../controllers/orgSettingsController';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /api/v1/org/api-keys:
 *   get:
 *     tags: [Organization]
 *     summary: Get organization API keys
 *     description: Returns the organization's public and secret API keys
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: API keys retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/api-keys', getApiKeys);

/**
 * @swagger
 * /api/v1/org/api-keys/regenerate-public:
 *   post:
 *     tags: [Organization]
 *     summary: Regenerate public API key
 *     description: Invalidates the current public key and creates a new one. Only admin or sales_manager.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Public key regenerated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/api-keys/regenerate-public', authorize('admin', 'sales_manager'), regeneratePublicKey);

/**
 * @swagger
 * /api/v1/org/api-keys/regenerate-secret:
 *   post:
 *     tags: [Organization]
 *     summary: Regenerate secret API key
 *     description: Invalidates the current secret key and creates a new one. Admin only.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Secret key regenerated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/api-keys/regenerate-secret', authorize('admin'), regenerateSecretKey);

export default router;
