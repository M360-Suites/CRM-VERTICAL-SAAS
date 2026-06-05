import { Router, type Request, type Router as RouterType } from 'express';
import multer from 'multer';
import { generateEmailHandler, sendEmailHandler } from '../controllers/emailWriterController';
import { authenticate, authorize } from '../middleware/auth';

const router: RouterType = Router();

router.use(authenticate);

type MulterOptions = NonNullable<Parameters<typeof multer>[0]>;
type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

const documentMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv'
]);

const emailUploadOptions: MulterOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    cb(null, documentMimeTypes.has(file.mimetype));
  }
};

const uploadEmailDocuments = multer(emailUploadOptions);

/**
 * 
 * @swagger
 * /ai/email/generate:
 *   post:
 *     summary: Generate an AI email using Groq
 *     tags: [AI Email Writer]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contact_id:
 *                 type: string
 *                 description: Optional selected contact ID for email context
 *               deal_id:
 *                 type: string
 *                 description: Optional selected deal ID for email context
 *               company_id:
 *                 type: string
 *                 deprecated: true
 *                 description: Optional company context for older clients
 *               purpose:
 *                 type: string
 *                 enum: [cold_outreach, follow_up, proposal, thank_you, meeting_request, re_engagement]
 *                 deprecated: true
 *                 default: follow_up
 *               tone:
 *                 type: string
 *                 enum: [friendly, professional, follow_up, cold_outreach, thank_you]
 *                 default: professional
 *                 description: Writer option selected from the AI writer form
 *               length:
 *                 type: string
 *                 enum: [short, medium, detailed]
 *                 default: medium
 *                 description: Email length preference
 *               recipient_name:
 *                 type: string
 *                 description: Override recipient display name
 *               sender_name:
 *                 type: string
 *                 description: Override sender display name
 *               key_points:
 *                 type: array
 *                 items:
 *                   type: string
 *                   maxLength: 220
 *                 maxItems: 10
 *                 description: Key points to include in the email
 *               custom_instructions:
 *                 type: string
 *                 maxLength: 1200
 *                 deprecated: true
 *                 description: Additional context or instructions for older clients
 *               additional_notes:
 *                 type: string
 *                 maxLength: 1200
 *                 description: Optional notes from the AI writer form
 *               subject:
 *                 type: string
 *                 maxLength: 180
 *                 description: Suggested subject line
 *     responses:
 *       200:
 *         description: Email generated successfully
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
 *                     subject:
 *                       type: string
 *                     body:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Provided CRM context record was not found
 *       500:
 *         description: Failed to generate email
 */
router.post('/email/generate', authorize('admin', 'sales_manager', 'sales_rep'), generateEmailHandler);

/**
 * @swagger
 * /ai/email/send:
 *   post:
 *     summary: Send a finalized AI email draft
 *     description: Sends from the authenticated user's connected Google account. Existing Gmail connections may need to reconnect so the app can request Gmail send permission.
 *     tags: [AI Email Writer]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subject, body]
 *             properties:
 *               contact_id:
 *                 type: string
 *                 description: Optional CRM contact to send to
 *               deal_id:
 *                 type: string
 *                 description: Optional deal to link the email activity to
 *               to:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       oneOf:
 *                         - type: string
 *                         - type: object
 *                           properties:
 *                             address:
 *                               type: string
 *                             email:
 *                               type: string
 *                             name:
 *                               type: string
 *                 description: Explicit recipient or recipients when no contact is selected
 *               subject:
 *                 type: string
 *                 maxLength: 180
 *               body:
 *                 type: string
 *                 maxLength: 10000
 *                 description: Final edited plain-text email body
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [subject, body]
 *             properties:
 *               contact_id:
 *                 type: string
 *               deal_id:
 *                 type: string
 *               to:
 *                 description: Recipient email, repeated field, or JSON string array
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               subject:
 *                 type: string
 *                 maxLength: 180
 *               body:
 *                 type: string
 *                 maxLength: 10000
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Optional PDF, DOC, DOCX, TXT, or CSV attachments. Maximum 10 files, 10MB each.
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Contact or deal not found
 *       500:
 *         description: Failed to send email
 */
router.post(
  '/email/send',
  authorize('admin', 'sales_manager', 'sales_rep'),
  uploadEmailDocuments.fields([
    { name: 'document', maxCount: 1 },
    { name: 'documents', maxCount: 10 },
    { name: 'attachments', maxCount: 10 }
  ]),
  sendEmailHandler
);

export default router;
