import { Router, type Router as RouterType } from 'express';
import { countSitesPublic } from '../controllers/publicSiteController';
import { authenticatePublicKey } from '../middleware/publicAuth';

const router: RouterType = Router();

/**
 * @swagger
 * /public/sites:
 *   get:
 *     tags: [Public]
 *     summary: Count sites connected to the public key
 *     description: Returns how many sites are connected to the public API key. Authenticated with the public key itself (x-api-key header). Usable by the client script to self-report usage.
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: x-api-key
 *         required: true
 *         schema: { type: string }
 *         description: Public API key (pk_live_*)
 *     responses:
 *       200:
 *         description: Site count retrieved
 *       401:
 *         description: Invalid or missing API key
 */
router.get('/', authenticatePublicKey, countSitesPublic);

export default router;