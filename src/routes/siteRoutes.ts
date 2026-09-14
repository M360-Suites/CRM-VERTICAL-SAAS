import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  listSites,
  countSites,
  registerSite,
  updateSite,
  deleteSite
} from '../controllers/siteController';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /org/sites:
 *   get:
 *     tags: [Organization]
 *     summary: List sites connected to the public key
 *     description: Returns paginated list of sites (domains) tracked against the organization's public API key.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sites retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/', listSites);

/**
 * @swagger
 * /org/sites/count:
 *   get:
 *     tags: [Organization]
 *     summary: Count sites connected to the public key
 *     description: Returns how many sites are connected to the organization's public API key, split by active/inactive and auto-detected/manual.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Site count retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/count', countSites);

/**
 * @swagger
 * /org/sites:
 *   post:
 *     tags: [Organization]
 *     summary: Register a site
 *     description: Manually register a site (domain) against the organization's public API key. Admin or sales_manager only.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [domain]
 *             properties:
 *               domain:
 *                 type: string
 *                 description: Site domain, e.g. example.com or https://example.com
 *               is_active:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Site registered
 *       400:
 *         description: Invalid domain
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/', authorize('admin', 'sales_manager'), registerSite);

/**
 * @swagger
 * /org/sites/{id}:
 *   patch:
 *     tags: [Organization]
 *     summary: Update a site
 *     description: Update a site (e.g. activate/deactivate). Admin or sales_manager only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Site updated
 *       400:
 *         description: Invalid site id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Site not found
 */
router.patch('/:id', authorize('admin', 'sales_manager'), updateSite);

/**
 * @swagger
 * /org/sites/{id}:
 *   delete:
 *     tags: [Organization]
 *     summary: Delete a site
 *     description: Remove a site from the organization. Admin or sales_manager only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Site deleted
 *       400:
 *         description: Invalid site id
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Site not found
 */
router.delete('/:id', authorize('admin', 'sales_manager'), deleteSite);

export default router;