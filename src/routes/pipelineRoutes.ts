import { Router, type Router as RouterType } from 'express';
import {
  assignPipelineStageMember,
  createPipelineDeal,
  createPipelineStage,
  deletePipelineDeal,
  deletePipelineStage,
  getPipeline,
  getPipelineDealActivities,
  getPipelineDeals,
  getPipelineStageAssignees,
  getPipelineStages,
  getPipelineTeamMembers,
  movePipelineDealStage,
  removePipelineStageMember,
  updatePipelineDeal,
  updatePipelineStage
} from '../controllers/pipelineController';
import { authenticate, authorize } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Pipeline
 *     description: Pipeline stages, deals, team members, and stage assignments
 */

/**
 * @swagger
 * /pipeline:
 *   get:
 *     summary: Get complete pipeline page data
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Complete pipeline payload with deals grouped under stages
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PipelinePageResponse'
 */
router.get('/', getPipeline);

/**
 * @swagger
 * /pipeline/stages:
 *   get:
 *     summary: Get all pipeline stages in order
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pipeline stages
 *   post:
 *     summary: Create a pipeline stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               position:
 *                 type: number
 *               is_won:
 *                 type: boolean
 *               is_lost:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Pipeline stage created
 */
router.get('/stages', getPipelineStages);
router.post('/stages', authorize('admin', 'sales_manager'), createPipelineStage);

/**
 * @swagger
 * /pipeline/stages/{stageId}:
 *   patch:
 *     summary: Update a pipeline stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stageId
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
 *               name:
 *                 type: string
 *               position:
 *                 type: number
 *               is_won:
 *                 type: boolean
 *               is_lost:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Pipeline stage updated
 *   delete:
 *     summary: Delete a pipeline stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pipeline stage deleted
 */
router.patch('/stages/:stageId', authorize('admin', 'sales_manager'), updatePipelineStage);
router.delete('/stages/:stageId', authorize('admin', 'sales_manager'), deletePipelineStage);

/**
 * @swagger
 * /pipeline/deals:
 *   get:
 *     summary: Get all pipeline deals
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pipeline deals
 *   post:
 *     summary: Create a pipeline deal
 *     tags: [Pipeline]
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
 *               source:
 *                 type: string
 *               industry:
 *                 type: string
 *               stage_id:
 *                 type: string
 *               company_id:
 *                 type: string
 *                 description: ID of the company to associate with this deal
 *     responses:
 *       201:
 *         description: Pipeline deal created
 */
router.get('/deals', getPipelineDeals);
router.post('/deals', authorize('admin', 'sales_manager', 'sales_rep'), createPipelineDeal);

/**
 * @swagger
 * /pipeline/deals/{dealId}:
 *   patch:
 *     summary: Update a pipeline deal
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
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
 *               source:
 *                 type: string
 *               industry:
 *                 type: string
 *               stage_id:
 *                 type: string
 *               company_id:
 *                 type: string
 *                 nullable: true
 *                 description: ID of the company to associate, or null to remove
 *     responses:
 *       200:
 *         description: Pipeline deal updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/PipelineDeal'
 *   delete:
 *     summary: Delete a pipeline deal
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pipeline deal deleted
 */
router.patch('/deals/:dealId', authorize('admin', 'sales_manager', 'sales_rep'), updatePipelineDeal);
router.delete('/deals/:dealId', authorize('admin', 'sales_manager'), deletePipelineDeal);

/**
 * @swagger
 * /pipeline/deals/{dealId}/stage:
 *   patch:
 *     summary: Move a deal to another stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
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
 *     responses:
 *       200:
 *         description: Deal moved and stage_change activity created
 */
router.patch('/deals/:dealId/stage', authorize('admin', 'sales_manager', 'sales_rep'), movePipelineDealStage);

/**
 * @swagger
 * /pipeline/deals/{dealId}/activities:
 *   get:
 *     summary: Get deal activity history
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deal activities
 */
router.get('/deals/:dealId/activities', getPipelineDealActivities);

/**
 * @swagger
 * /pipeline/team-members:
 *   get:
 *     summary: Get assignable team members
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Team members
 */
router.get('/team-members', getPipelineTeamMembers);

/**
 * @swagger
 * /pipeline/stage-assignees:
 *   get:
 *     summary: Get all stage assignments
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stage assignees
 */
router.get('/stage-assignees', getPipelineStageAssignees);

/**
 * @swagger
 * /pipeline/stages/{stageId}/assignees:
 *   post:
 *     summary: Assign a team member to a pipeline stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id]
 *             properties:
 *               user_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Stage assignee created
 */
router.post('/stages/:stageId/assignees', authorize('admin', 'sales_manager'), assignPipelineStageMember);

/**
 * @swagger
 * /pipeline/stages/{stageId}/assignees/{userId}:
 *   delete:
 *     summary: Remove a team member from a pipeline stage
 *     tags: [Pipeline]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stageId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stage assignee removed
 */
router.delete('/stages/:stageId/assignees/:userId', authorize('admin', 'sales_manager'), removePipelineStageMember);

export default router;
