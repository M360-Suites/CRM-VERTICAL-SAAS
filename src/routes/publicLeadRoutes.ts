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
 *     description: Creates a contact and a deal from an anonymous form submission, then the Revenue Engine routes it (score, routing rule or least-loaded rep, owner notification, attribution touchpoints, pending nurture draft). Requires a valid public API key.
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
 *               value:
 *                 oneOf:
 *                   - type: number
 *                   - type: string
 *                 description: Deal value / budget (aliases deal_value, estimated_value, budget, amount). Accepts "$5,000", "5k", "1.2m", ranges like "5k-10k" (midpoint). Omitted or unparseable leaves the deal value unknown (null), never 0.
 *                 example: 5k-10k
 *               currency:
 *                 type: string
 *                 description: 3-letter currency code for the deal value (default USD)
 *                 example: USD
 *               intent_score:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Revenue Engine routing score. Defaults from temperature (hot 80, warm 50, cold 25) or 50.
 *               region:
 *                 type: string
 *                 description: Matched against routing rule regions (case-insensitive), e.g. EMEA
 *               tier:
 *                 type: string
 *                 description: Matched against routing rule tiers, e.g. Enterprise
 *               channel:
 *                 type: string
 *                 enum: [email, whatsapp, sms]
 *                 description: Channel for the auto-generated nurture draft. Defaults to email if an email is given, else whatsapp.
 *               platform:
 *                 type: string
 *                 enum: [google_ads, meta, linkedin, tiktok, web_form, seo, other]
 *                 description: Traffic source. Auto-detected from click IDs / UTM tags when omitted.
 *               utm_source:
 *                 type: string
 *               utm_medium:
 *                 type: string
 *               utm_campaign:
 *                 type: string
 *               campaign_id:
 *                 type: string
 *                 description: Ad platform campaign ID (alias utm_id) — links the lead to that campaign's spend for ROI
 *               gclid:
 *                 type: string
 *                 description: Google Ads click ID (also gbraid / wbraid)
 *               fbclid:
 *                 type: string
 *               li_fat_id:
 *                 type: string
 *               ttclid:
 *                 type: string
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
