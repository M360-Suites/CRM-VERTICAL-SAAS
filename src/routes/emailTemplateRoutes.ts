import { Router, type Router as RouterType } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listMergeVariables,
  listTemplates,
  previewTemplate,
  sendTestTemplate,
  updateTemplate
} from '../controllers/emailTemplateController';

const router: RouterType = Router();

/** Admins author templates; everyone in the org can read */
const MANAGE = authorize('admin');

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: Email Templates
 *     description: Canvas-built email templates used by triggers and broadcasts
 */

/**
 * @swagger
 * /email-templates:
 *   get:
 *     tags: [Email Templates]
 *     summary: List templates (without html/design), newest first
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *   post:
 *     tags: [Email Templates]
 *     summary: Create a template (admin)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, subject, html]
 *             properties:
 *               name: { type: string }
 *               subject: { type: string, example: "Thanks for your interest, {{contact.first_name | there}}" }
 *               preview_text: { type: string }
 *               html: { type: string, description: Rendered canvas HTML. Merge tags like {{contact.first_name}} are filled at send time. }
 *               design: { type: object, description: The canvas editor's own JSON, stored as-is so the editor can reload it }
 */
router.get('/', listTemplates);
router.post('/', MANAGE, createTemplate);

/**
 * @swagger
 * /email-templates/variables:
 *   get:
 *     tags: [Email Templates]
 *     summary: Merge tags available to templates (for the canvas variable picker)
 *     security:
 *       - bearerAuth: []
 */
router.get('/variables', listMergeVariables);

/**
 * @swagger
 * /email-templates/preview:
 *   post:
 *     tags: [Email Templates]
 *     summary: Render unsaved subject/html with sample merge data
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, html]
 *             properties:
 *               subject: { type: string }
 *               html: { type: string }
 */
router.post('/preview', previewTemplate);

/**
 * @swagger
 * /email-templates/{id}:
 *   get:
 *     tags: [Email Templates]
 *     summary: Get a template with html and design
 *     security:
 *       - bearerAuth: []
 *   patch:
 *     tags: [Email Templates]
 *     summary: Update a template (admin)
 *     security:
 *       - bearerAuth: []
 *   delete:
 *     tags: [Email Templates]
 *     summary: Delete a template — 409 while a trigger uses it (admin)
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id', getTemplate);
router.patch('/:id', MANAGE, updateTemplate);
router.delete('/:id', MANAGE, deleteTemplate);

/**
 * @swagger
 * /email-templates/{id}/duplicate:
 *   post:
 *     tags: [Email Templates]
 *     summary: Copy a template (admin)
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/duplicate', MANAGE, duplicateTemplate);

/**
 * @swagger
 * /email-templates/{id}/test:
 *   post:
 *     tags: [Email Templates]
 *     summary: Send the template to yourself with sample merge data
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/test', MANAGE, sendTestTemplate);

export default router;
