import { Router, type Router as RouterType } from 'express';
import { getAllDeals } from '../controllers/dealController';
import { authenticate } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Deals
 *     description: Organization deals and opportunities
 */

/**
 * @swagger
 * /deals/all:
 *   get:
 *     summary: Get all organization deals
 *     description: Returns all deals scoped to the authenticated user's organization without pagination.
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deals retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DealListResponse'
 */
router.get('/all', getAllDeals);

export default router;
