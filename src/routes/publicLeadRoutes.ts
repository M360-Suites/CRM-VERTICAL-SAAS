import { Router, type Router as RouterType } from 'express';
import { captureLead } from '../controllers/publicLeadController';
import { authenticatePublicKey } from '../middleware/publicAuth';
import { trackSite } from '../middleware/siteTracker';
import { publicLeadRateLimit } from '../middleware/security';

const router: RouterType = Router();

/**
 * @swagger
 * /public/leads/inbound:
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
 *               name:
 *                 type: string
 *                 description: Full name (also accepts full_name, fullname, "full name" - auto-split into first/last)
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
 *               tags:
 *                 oneOf:
 *                   - type: string
 *                     description: Comma-separated tags, e.g. "newsletter,priority"
 *                   - type: array
 *                     items: { type: string }
 *                     description: List of tags to add to the contact (merged with web-capture and source)
 *               site:
 *                 type: string
 *                 description: The site domain making the request (e.g. example.com). Auto-detected from Referer/Origin headers if omitted.
 *               domain:
 *                 type: string
 *                 description: Alias for site
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
router.post('/inbound', publicLeadRateLimit, authenticatePublicKey, trackSite, captureLead);

export default router;
