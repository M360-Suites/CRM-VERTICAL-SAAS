import { Router, type Router as RouterType } from 'express';
import { authenticateIngestSecret } from '../middleware/ingestAuth';
import { publicLeadRateLimit } from '../middleware/security';
import { ingestAdEvents } from '../controllers/publicIngestController';

const router: RouterType = Router();

/**
 * @swagger
 * /public/ingest/ad-events:
 *   post:
 *     tags: [Public]
 *     summary: Push ad spend rows (server-to-server)
 *     description: |
 *       Authenticated with the organization's secret key (sk_live_*) in the `x-ingest-secret` header.
 *       Rows upsert on (platform, campaign_id, adset_id, creative_id, date) — re-sending a batch never duplicates spend.
 *     security:
 *       - ingestSecretAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 maxItems: 500
 *                 items:
 *                   type: object
 *                   required: [platform, name, date]
 *                   properties:
 *                     platform: { type: string, enum: [google_ads, meta, linkedin, tiktok, web_form, seo, other] }
 *                     campaign_id: { type: string }
 *                     adset_id: { type: string }
 *                     creative_id: { type: string }
 *                     name: { type: string }
 *                     date: { type: string, example: 2026-10-01 }
 *                     spend: { type: number }
 *                     impressions: { type: integer }
 *                     clicks: { type: integer }
 *                     currency: { type: string, example: USD }
 *     responses:
 *       200:
 *         description: "{ ingested, spend, platforms }"
 *       400:
 *         description: Invalid payload, with per-event issues
 *       401:
 *         description: Invalid credentials
 */
router.post('/ad-events', publicLeadRateLimit, authenticateIngestSecret, ingestAdEvents);

export default router;
