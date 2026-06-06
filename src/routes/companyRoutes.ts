/**
 * Company management routes
 * Handles CRUD operations for companies
 */
import { Router, type Router as RouterType } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import {
  listCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyContacts,
  getCompanyDeals,
  getCompanyStats,
  exportCompanies,
  bulkImportCompanies
} from '../controllers/companyController';
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
 * /companies:
 *   get:
 *     summary: List organization companies
 *     description: Returns companies scoped to the authenticated user's organization.
 *     tags: [Companies]
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
 *         name: owner_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: industry
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Companies retrieved successfully. Each company includes stats with contact_count, deal_count, pipeline_value, and won_revenue.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CompanyPaginatedResponse'
 */
router.get('/', listCompanies);

/**
 * @swagger
 * /companies/export:
 *   get:
 *     summary: Export organization companies
 *     description: Exports companies scoped to the authenticated user's organization.
 *     tags: [Companies]
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
 */
router.get('/export', authorize('admin', 'sales_manager'), exportCompanies);

/**
 * @swagger
 * /companies/bulk-import:
 *   post:
 *     summary: Bulk import companies
 *     tags: [Companies]
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
 *                 description: CSV with a required name column. Optional columns include industry, website, email, phone, address, contact_person, and notes.
 *     responses:
 *       200:
 *         description: Companies imported successfully
 */
router.post('/bulk-import', authorize('admin', 'sales_manager', 'sales_rep'), uploadCsv.single('file'), bulkImportCompanies);

/**
 * @swagger
 * /companies/{id}:
 *   get:
 *     summary: Get company by ID
 *     tags: [Companies]
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
 *         description: Company retrieved successfully with stats containing contact_count, deal_count, pipeline_value, and won_revenue.
 *       404:
 *         description: Company not found
 */
router.get('/:id', getCompanyById);

/**
 * @swagger
 * /companies:
 *   post:
 *     summary: Create a company
 *     tags: [Companies]
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
 *               industry:
 *                 type: string
 *               website:
 *                 type: string
 *               notes:
 *                 type: string
 *               contact_person:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       201:
 *         description: Company created successfully with stats containing contact_count, deal_count, pipeline_value, and won_revenue.
 */
router.post('/', authorize('admin', 'sales_manager', 'sales_rep'), createCompany);

/**
 * @swagger
 * /companies/{id}:
 *   patch:
 *     summary: Update company
 *     tags: [Companies]
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
 *               name:
 *                 type: string
 *               industry:
 *                 type: string
 *               website:
 *                 type: string
 *               notes:
 *                 type: string
 *               contact_person:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Company updated successfully with stats containing contact_count, deal_count, pipeline_value, and won_revenue.
 */
router.patch('/:id', authorize('admin', 'sales_manager', 'sales_rep'), updateCompany);

/**
 * @swagger
 * /companies/{id}:
 *   delete:
 *     summary: Delete company
 *     tags: [Companies]
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
 *         description: Company deleted successfully
 *       403:
 *         description: Admin or sales_manager access required
 */
router.delete('/:id', authorize('admin', 'sales_manager'), deleteCompany);

/**
 * @swagger
 * /companies/{id}/contacts:
 *   get:
 *     summary: Get company contacts
 *     tags: [Companies]
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
 *         description: Contacts retrieved successfully
 */
router.get('/:id/contacts', getCompanyContacts);

/**
 * @swagger
 * /companies/{id}/deals:
 *   get:
 *     summary: Get company deals
 *     tags: [Companies]
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
router.get('/:id/deals', getCompanyDeals);

/**
 * @swagger
 * /companies/{id}/stats:
 *   get:
 *     summary: Get company stats
 *     tags: [Companies]
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
 *         description: Stats retrieved successfully
 */
router.get('/:id/stats', getCompanyStats);

export default router;
