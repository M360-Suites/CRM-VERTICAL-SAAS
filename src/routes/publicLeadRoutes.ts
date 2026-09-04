import { Router, type Router as RouterType } from 'express';
import { captureLead } from '../controllers/publicLeadController';
import { authenticatePublicKey } from '../middleware/publicAuth';
import { publicLeadRateLimit } from '../middleware/security';

const router: RouterType = Router();

/**
 * @swagger
 * /api/v1/public/leads/inbound:
 *   post:
 *     tags: [Public]
 *     summary: Capture a lead from script tag
 *     description: Creates a contact from an anonymous form submission. Requires a valid public API key.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key]
 *             properties:
 *               key:
 *                 type: string
 *                 description: Public API key (pk_live_*)
 *                 example: pk_live_abc123...
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               company:
 *                 type: string
 *               message:
 *                 type: string
 *               source:
 *                 type: string
 *               temperature:
 *                 type: string
 *                 enum: [hot, warm, cold]
 *     responses:
 *       201:
 *         description: Lead captured successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid or missing API key
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/inbound', publicLeadRateLimit, authenticatePublicKey, captureLead);

export default router;
