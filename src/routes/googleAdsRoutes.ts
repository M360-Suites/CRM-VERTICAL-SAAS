import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  disconnectGoogleAds,
  getGoogleAdsAuthUrl,
  getGoogleAdsStatus,
  handleGoogleAdsCallback,
  listGoogleAdsAccounts,
  selectGoogleAdsAccount,
  syncGoogleAdsNow
} from '../controllers/googleAdsController';

const router: RouterType = Router();

/**
 * @swagger
 * /integrations/google-ads/callback:
 *   get:
 *     tags: [Integrations]
 *     summary: Google OAuth callback for Google Ads
 *     description: Called by Google. Verifies the signed state, stores the refresh token and redirects to the frontend account picker.
 *     responses:
 *       302:
 *         description: Redirect to /settings/integrations?provider=google_ads&step=select_account (or &error=...)
 */
router.get('/callback', handleGoogleAdsCallback);

router.use(authenticate);

/**
 * @swagger
 * /integrations/google-ads/status:
 *   get:
 *     tags: [Integrations]
 *     summary: Google Ads connection status for the organization
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status with account, currency and last sync info
 */
router.get('/status', getGoogleAdsStatus);

/**
 * @swagger
 * /integrations/google-ads/auth:
 *   get:
 *     tags: [Integrations]
 *     summary: Get the Google Ads OAuth consent URL
 *     description: Admin or sales_manager only.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ url }"
 *       503:
 *         description: Google Ads not configured on the server
 */
router.get('/auth', authorize('admin', 'sales_manager'), getGoogleAdsAuthUrl);

/**
 * @swagger
 * /integrations/google-ads/accounts:
 *   get:
 *     tags: [Integrations]
 *     summary: List ad accounts the connected Google login can access
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "[{ customer_id, name, currency, login_customer_id }]"
 */
router.get('/accounts', authorize('admin', 'sales_manager'), listGoogleAdsAccounts);

/**
 * @swagger
 * /integrations/google-ads/accounts/select:
 *   post:
 *     tags: [Integrations]
 *     summary: Bind the organization to one Google Ads account and start the backfill
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 example: 123-456-7890
 */
router.post('/accounts/select', authorize('admin', 'sales_manager'), selectGoogleAdsAccount);

/**
 * @swagger
 * /integrations/google-ads/sync:
 *   post:
 *     tags: [Integrations]
 *     summary: Re-sync Google Ads spend now
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               days:
 *                 type: integer
 *                 maximum: 90
 */
router.post('/sync', authorize('admin', 'sales_manager'), syncGoogleAdsNow);

/**
 * @swagger
 * /integrations/google-ads:
 *   delete:
 *     tags: [Integrations]
 *     summary: Disconnect Google Ads (historical spend is kept)
 *     security:
 *       - bearerAuth: []
 */
router.delete('/', authorize('admin'), disconnectGoogleAds);

export default router;
