import { Router, type Router as RouterType } from 'express';
import {
  listDeals,
  getAllDeals,
  getDealById,
  createDeal,
  updateDeal,
  deleteDeal,
  getDealActivities,
  getDealTasks,
  getDealStats,
  updateDealStage,
  bulkUpdateStage,
  assignDeal
} from '../controllers/dealController';
import { authenticate, authorize } from '../middleware/auth';

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
 * /deals:
 *   get:
 *     summary: List organization deals
 *     description: Returns paginated deals scoped to the authenticated user's organization. Supports search and filtering.
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: company_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: owner_id
 *         description: Filter by owner user ID, or pass `unassigned` to list deals with no owner
 *         schema:
 *           type: string
 *       - in: query
 *         name: stage_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, won, lost]
 *     responses:
 *       200:
 *         description: Deals retrieved successfully
 */
router.get('/', listDeals);

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

/**
 * @swagger
 * /deals:
 *   post:
 *     summary: Create a deal
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *               value:
 *                 type: number
 *               currency:
 *                 type: string
 *                 default: USD
 *               expected_close_date:
 *                 type: string
 *                 format: date
 *               stage_id:
 *                 type: string
 *                 description: ID of the pipeline stage
 *               source:
 *                 type: string
 *               industry:
 *                 type: string
 *               company_id:
 *                 type: string
 *                 description: ID of the company to associate
 *               contact_id:
 *                 type: string
 *                 description: ID of the contact to associate
 *     responses:
 *       201:
 *         description: Deal created successfully
 */
router.post('/', authorize('admin', 'sales_manager', 'sales_rep'), createDeal);

/**
 * @swagger
 * /deals/{id}:
 *   get:
 *     summary: Get deal by ID
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal retrieved successfully
 *       404:
 *         description: Deal not found
 */
router.get('/:id', getDealById);

/**
 * @swagger
 * /deals/{id}:
 *   patch:
 *     summary: Update a deal
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               value:
 *                 type: number
 *               currency:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [open, won, lost]
 *               expected_close_date:
 *                 type: string
 *                 format: date
 *               stage_id:
 *                 type: string
 *               source:
 *                 type: string
 *               industry:
 *                 type: string
 *               company_id:
 *                 type: string
 *                 nullable: true
 *                 description: ID of the company to associate, or null to remove
 *               contact_id:
 *                 type: string
 *                 nullable: true
 *                 description: ID of the contact to associate, or null to remove
 *     responses:
 *       200:
 *         description: Deal updated successfully
 */
router.patch('/:id', authorize('admin', 'sales_manager', 'sales_rep'), updateDeal);

/**
 * @swagger
 * /deals/{id}/assign:
 *   patch:
 *     summary: Assign a deal to a person
 *     description: |
 *       Sets the single owner of a deal, or clears it with `owner_id: null`. Admins and sales managers only.
 *       The owner must be an active admin, sales manager or sales rep in the same organization.
 *       If the deal's contact has no owner yet, it gets the same owner. A `deal_assigned` activity is
 *       logged and the new owner gets an in-app notification. `owner_id` cannot be changed through PATCH /deals/{id}.
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner_id]
 *             properties:
 *               owner_id:
 *                 type: string
 *                 nullable: true
 *                 description: User ID of the new owner, or null to unassign
 *           example:
 *             owner_id: 507f1f77bcf86cd799439011
 *     responses:
 *       200:
 *         description: Deal assigned (or unassigned); returns the updated deal
 *       400:
 *         description: Invalid deal ID / owner_id, or the user cannot own deals
 *       403:
 *         description: Only admins and sales managers can assign deals
 *       404:
 *         description: Deal not found
 */
router.patch('/:id/assign', authorize('admin', 'sales_manager'), assignDeal);

/**
 * @swagger
 * /deals/{id}:
 *   delete:
 *     summary: Delete a deal
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal deleted successfully
 */
router.delete('/:id', authorize('admin', 'sales_manager'), deleteDeal);

/**
 * @swagger
 * /deals/{id}/activities:
 *   get:
 *     summary: Get deal activity history
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal activities retrieved successfully
 */
router.get('/:id/activities', getDealActivities);

/**
 * @swagger
 * /deals/{id}/tasks:
 *   get:
 *     summary: Get tasks linked to a deal
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal tasks retrieved successfully
 */
router.get('/:id/tasks', getDealTasks);

/**
 * @swagger
 * /deals/{id}/stats:
 *   get:
 *     summary: Get deal statistics
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal stats retrieved successfully
 */
router.get('/:id/stats', getDealStats);

/**
 * @swagger
 * /deals/{id}/stage:
 *   patch:
 *     summary: Move a deal to a different stage
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage_id]
 *             properties:
 *               stage_id:
 *                 type: string
 *               stageId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Deal stage updated successfully
 */
router.patch('/:id/stage', authorize('admin', 'sales_manager', 'sales_rep'), updateDealStage);

/**
 * @swagger
 * /deals/bulk-stage:
 *   post:
 *     summary: Bulk update stage for multiple deals
 *     tags: [Deals]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deal_ids, stage_id]
 *             properties:
 *               deal_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               stage_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Deals stage updated successfully
 */
router.post('/bulk-stage', authorize('admin', 'sales_manager'), bulkUpdateStage);

export default router;
