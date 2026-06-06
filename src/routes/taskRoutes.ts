/**
 * Task management routes
 * Handles CRUD operations for tasks
 */
import { Router, type Router as RouterType } from 'express';
import {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getMyTasks,
  completeTask,
  getUpcomingTasks
} from '../controllers/taskController';
import { authenticate, authorize } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: List tasks
 *     tags: [Tasks]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed, cancelled]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high, urgent]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [task, meeting, call, follow_up]
 *       - in: query
 *         name: owner_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: assignee_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: contact_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: deal_id
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tasks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskPaginatedResponse'
 */
router.get('/', listTasks);

/**
 * @swagger
 * /tasks/my:
 *   get:
 *     summary: Get my tasks
 *     tags: [Tasks]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: My tasks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskListResponse'
 */
router.get('/my', getMyTasks);

/**
 * @swagger
 * /tasks/upcoming:
 *   get:
 *     summary: Get upcoming tasks
 *     tags: [Tasks]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Upcoming tasks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskListResponse'
 */
router.get('/upcoming', getUpcomingTasks);

/**
 * @swagger
 * /tasks/{id}:
 *   get:
 *     summary: Get task by ID
 *     tags: [Tasks]
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
 *         description: Task retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskResponse'
 *       404:
 *         description: Task not found
 */
router.get('/:id', getTaskById);

/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Create a task
 *     tags: [Tasks]
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
 *               type:
 *                 type: string
 *                 enum: [task, meeting, call, follow_up]
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *               status:
 *                 type: string
 *                 enum: [pending, in_progress, completed, cancelled]
 *               description:
 *                 type: string
 *               due_at:
 *                 type: string
 *                 format: date-time
 *               duration_minutes:
 *                 type: integer
 *               location:
 *                 type: string
 *               meeting_url:
 *                 type: string
 *               contact_id:
 *                 type: string
 *               deal_id:
 *                 type: string
 *               company_id:
 *                 type: string
 *               assignees:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskResponse'
 */
router.post('/', authorize('admin', 'sales_manager', 'sales_rep'), createTask);

/**
 * @swagger
 * /tasks/{id}:
 *   patch:
 *     summary: Update task
 *     tags: [Tasks]
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
 *               type:
 *                 type: string
 *               priority:
 *                 type: string
 *               status:
 *                 type: string
 *               description:
 *                 type: string
 *               due_at:
 *                 type: string
 *                 format: date-time
 *               duration_minutes:
 *                 type: integer
 *               location:
 *                 type: string
 *               meeting_url:
 *                 type: string
 *               contact_id:
 *                 type: string
 *               deal_id:
 *                 type: string
 *               company_id:
 *                 type: string
 *               assignees:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Task updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskResponse'
 */
router.patch('/:id', authorize('admin', 'sales_manager', 'sales_rep'), updateTask);

/**
 * @swagger
 * /tasks/{id}:
 *   delete:
 *     summary: Delete task
 *     tags: [Tasks]
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
 *         description: Task deleted successfully
 *       403:
 *         description: Admin or sales_manager access required
 */
router.delete('/:id', authorize('admin', 'sales_manager'), deleteTask);

/**
 * @swagger
 * /tasks/{id}/complete:
 *   post:
 *     summary: Complete task
 *     tags: [Tasks]
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
 *         description: Task completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TaskResponse'
 */
router.post('/:id/complete', authorize('admin', 'sales_manager', 'sales_rep'), completeTask);

export default router;
