import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { listSuppressions, removeSuppression } from '../controllers/emailSuppressionController';

const router: RouterType = Router();

router.use(authenticate, authorize('admin'));

/**
 * @swagger
 * /email-suppressions:
 *   get:
 *     tags: [Broadcasts]
 *     summary: Contacts excluded from broadcasts and trigger emails (admin)
 *     description: Contacts who unsubscribed, hard-bounced or complained. Newest first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: reason, schema: { type: string, enum: [unsubscribed, bounced, complained] } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches email or name }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200:
 *         description: Page of suppressions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           contact_id: { type: string }
 *                           name: { type: string, nullable: true }
 *                           email: { type: string, nullable: true }
 *                           reason: { type: string, enum: [unsubscribed, bounced, complained], nullable: true }
 *                           suppressed_at: { type: string, format: date-time, nullable: true }
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total_pages: { type: integer }
 *                     counts:
 *                       type: object
 *                       description: Totals per reason, ignoring the reason/search filters
 *                       properties:
 *                         unsubscribed: { type: integer }
 *                         bounced: { type: integer }
 *                         complained: { type: integer }
 */
router.get('/', listSuppressions);

/**
 * @swagger
 * /email-suppressions/{contactId}:
 *   delete:
 *     tags: [Broadcasts]
 *     summary: Let a suppressed contact receive email again (admin)
 *     description: Use only when the contact asked to rejoin, or a bounced address was corrected.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: contactId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: 'Removed — data: { contact_id, email }' }
 *       404: { description: Contact not found }
 *       409: { description: Contact is not suppressed }
 */
router.delete('/:contactId', removeSuppression);

export default router;
