import { Router, type Router as RouterType } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import {
  createFolder,
  deleteFolder,
  getFolderById,
  getFolderDocuments,
  getFolders,
  updateFolder,
  uploadDocumentsToFolder
} from '../controllers/documentController';
import { authenticate, authorize } from '../middleware/auth';

type MulterOptions = NonNullable<Parameters<typeof multer>[0]>;
type FileFilterCallback = {
  (error: Error): void;
  (error: null, acceptFile: boolean): void;
};

const uploadOptions: MulterOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowedMime = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/tiff',
      'image/bmp',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/ogg',
      'audio/aac',
      'audio/flac',
      'audio/webm',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/aiff',
      'audio/x-aiff',
      'audio/wma',
      'audio/x-ms-wma',
      'audio/x-msvideo',
      'audio/mid',
      'audio/x-midi',
      'text/plain',
      'text/csv'
    ];

    const allowedExt = /\.(pdf|doc|docx|jpg|jpeg|png|gif|webp|svg|tiff|tif|bmp|mp3|wav|ogg|oga|aac|flac|webm|m4a|mp4|aiff|aif|wma|mid|midi|txt|csv)$/i;

    const mimeOk = allowedMime.includes(file.mimetype);
    const extOk = allowedExt.test(file.originalname);
    cb(null, mimeOk || extOk);
  }
};

const upload = multer(uploadOptions);
const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /folders:
 *   get:
 *     summary: Get all folders
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Folders retrieved successfully
 *   post:
 *     summary: Create a folder
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 120
 *               description:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       201:
 *         description: Folder created successfully
 *       400:
 *         description: Folder name is required
 */
router.get('/', getFolders);
router.post('/', authorize('admin', 'sales_manager', 'sales_rep'), createFolder);

/**
 * @swagger
 * /folders/{folderId}:
 *   get:
 *     summary: Get a folder by ID
 *     description: Returns the folder and the documents/files inside it.
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Folder retrieved successfully
 *       400:
 *         description: Invalid folder ID
 *       404:
 *         description: Folder not found
 *   patch:
 *     summary: Edit a folder
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
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
 *                 maxLength: 120
 *               description:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Folder updated successfully
 *       400:
 *         description: Invalid folder ID
 *       404:
 *         description: Folder not found
 *   delete:
 *     summary: Delete a folder
 *     description: Deletes the folder and all documents inside it.
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Folder deleted successfully
 *       400:
 *         description: Invalid folder ID
 *       404:
 *         description: Folder not found
 */
router.get('/:folderId', getFolderById);
router.patch('/:folderId', authorize('admin', 'sales_manager', 'sales_rep'), updateFolder);
router.delete('/:folderId', authorize('admin', 'sales_manager'), deleteFolder);

/**
 * @swagger
 * /folders/{folderId}/documents:
 *   get:
 *     summary: Get documents inside a folder
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Folder documents retrieved successfully
 *       400:
 *         description: Invalid folder ID
 *       404:
 *         description: Folder not found
 *   post:
 *     summary: Upload documents into a folder
 *     description: Upload one file with `document` or multiple files with `documents`. Maximum 10 files, 25MB each.
 *     tags: [Folders]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: folderId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Documents uploaded successfully
 *       400:
 *         description: Invalid folder ID or no documents provided
 *       404:
 *         description: Folder not found
 */
router.get('/:folderId/documents', getFolderDocuments);
router.post(
  '/:folderId/documents',
  authorize('admin', 'sales_manager', 'sales_rep'),
  upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'documents', maxCount: 10 },
    { name: 'file', maxCount: 1 }
  ]),
  uploadDocumentsToFolder
);

export default router;
