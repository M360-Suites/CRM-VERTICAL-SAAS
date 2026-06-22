/**
 * Contact management routes
 * Handles CRUD operations for contacts and related data
 */
import { Router, type Router as RouterType } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import {
  listContacts,
  getAllContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  getContactActivities,
  getContactDeals,
  getContactTasks,
  bulkImportContacts,
  exportContacts
} from '../controllers/contactController';
import { authenticate, authorize } from '../middleware/auth';

type MulterOptions = NonNullable<Parameters<typeof multer>[0]>;
type FileFilterCallback = {
  (error: Error): void;
  (error: null, acceptFile: boolean): void;
};

const csvUploadOptions: MulterOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const isCsv =
      file.originalname.toLowerCase().endsWith('.csv') ||
      ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype);

    cb(null, isCsv);
  }
};

const uploadCsv = multer(csvUploadOptions);
const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /contacts:
 *   get:
 *     summary: List organization contacts
 *     description: Returns contacts scoped to the authenticated user's organization.
 *     tags: [Contacts]
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
 *         schema:
 *           type: string
 *       - in: query
 *         name: temperature
 *         schema:
 *           type: string
 *           enum: [hot, warm, cold]
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contacts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactPaginatedResponse'
 */
router.get('/', listContacts);

/**
 * @swagger
 * /contacts/all:
 *   get:
 *     summary: Get all organization contacts
 *     description: Returns all contacts scoped to the authenticated user's organization without pagination.
 *     tags: [Contacts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Contacts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContactListResponse'
 */
router.get('/all', getAllContacts);

/**
 * @swagger
 * /contacts/export:
 *   get:
 *     summary: Export organization contacts
 *     description: Exports contacts scoped to the authenticated user's organization.
 *     tags: [Contacts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, json]
 *           default: csv
 *     responses:
 *       200:
 *         description: File downloaded
 *       403:
 *         description: Admin or sales_manager access required
 */
router.get('/export', authenticate, authorize('admin', 'sales_manager'), exportContacts);

/**
 * @swagger
 * /contacts/{id}:
 *   get:
 *     summary: Get contact by ID
 *     tags: [Contacts]
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
 *         description: Contact retrieved successfully
 *       404:
 *         description: Contact not found
 */
router.get('/:id', getContactById);

/**
 * @swagger
 * /contacts:
 *   post:
 *     summary: Create a contact
 *     tags: [Contacts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [first_name, last_name]
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               role_title:
 *                 type: string
 *               company_id:
 *                 type: string
 *               temperature:
 *                 type: string
 *                 enum: [hot, warm, cold]
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Contact created successfully
 *       400:
 *         description: Missing required fields or invalid company ID
 *       403:
 *         description: Insufficient permissions
 */
router.post('/', authorize('admin', 'sales_manager', 'sales_rep'), createContact);

/**
 * @swagger
 * /contacts/{id}:
 *   patch:
 *     summary: Update contact
 *     tags: [Contacts]
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
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               role_title:
 *                 type: string
 *               company_id:
 *                 type: string
 *               temperature:
 *                 type: string
 *                 enum: [hot, warm, cold]
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Contact updated successfully
 *       404:
 *         description: Contact not found
 */
router.patch('/:id', authorize('admin', 'sales_manager', 'sales_rep'), updateContact);

/**
 * @swagger
 * /contacts/{id}:
 *   delete:
 *     summary: Delete contact
 *     tags: [Contacts]
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
 *         description: Contact deleted successfully
 *       403:
 *         description: Admin or sales_manager access required
 *       404:
 *         description: Contact not found
 */
router.delete('/:id', authorize('admin', 'sales_manager'), deleteContact);

/**
 * @swagger
 * /contacts/{id}/activities:
 *   get:
 *     summary: Get contact activities
 *     tags: [Contacts]
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
 *         description: Activities retrieved successfully
 */
router.get('/:id/activities', getContactActivities);

/**
 * @swagger
 * /contacts/{id}/deals:
 *   get:
 *     summary: Get contact deals
 *     tags: [Contacts]
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
 *         description: Deals retrieved successfully
 */
router.get('/:id/deals', getContactDeals);

/**
 * @swagger
 * /contacts/{id}/tasks:
 *   get:
 *     summary: Get contact tasks
 *     tags: [Contacts]
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
 *         description: Tasks retrieved successfully
 */
router.get('/:id/tasks', getContactTasks);

/**
 * @swagger
 * /contacts/bulk-import:
 *   post:
 *     summary: Bulk import contacts
 *     tags: [Contacts]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV with first_name and last_name columns. Optional columns include email, phone, role_title, company_id, temperature, and tags.
 *     responses:
 *       200:
 *         description: Contacts imported successfully
 */
router.post('/bulk-import', authorize('admin', 'sales_manager', 'sales_rep'), uploadCsv.single('file'), bulkImportContacts);

export default router;
