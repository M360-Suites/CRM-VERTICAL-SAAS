import { Router, type Router as RouterType } from 'express';
import {
  listStageMessages,
  createStageMessage,
  updateStageMessage,
  deleteStageMessage
} from '../controllers/stageMessageController';
import { authenticate } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Stage Messages
 *     description: Internal discussion/comments on pipeline stages
 */

/**
 * @swagger
 * /pipeline/stages/{stageId}/messages:
 *   get:
 *     summary: List messages in a stage discussion (stage assignees only)
 *     tags: [Stage Messages]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stageId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 30
 *     responses:
 *       200:
 *         description: Stage messages retrieved successfully
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
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/StageMessage'
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *       403:
 *         description: Not a stage assignee
 *   post:
 *     summary: Post a message in a stage discussion
 *     tags: [Stage Messages]
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
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 5000
 *     responses:
 *       201:
 *         description: Message posted successfully
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
 *                   $ref: '#/components/schemas/StageMessage'
 */
router.get('/:stageId/messages', listStageMessages);
router.post('/:stageId/messages', createStageMessage);

/**
 * @swagger
 * /pipeline/stages/{stageId}/messages/{messageId}:
 *   patch:
 *     summary: Update a message (author or admin/sales manager)
 *     tags: [Stage Messages]
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
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 5000
 *     responses:
 *       200:
 *         description: Message updated successfully
 *       403:
 *         description: Not the author
 *       404:
 *         description: Message not found
 *   delete:
 *     summary: Delete a message (author or admin/sales manager)
 *     tags: [Stage Messages]
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
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Message deleted successfully
 *       403:
 *         description: Not the author
 *       404:
 *         description: Message not found
 */
router.patch('/:stageId/messages/:messageId', updateStageMessage);
router.delete('/:stageId/messages/:messageId', deleteStageMessage);

export default router;
