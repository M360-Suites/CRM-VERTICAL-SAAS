import { Router, type Router as RouterType, type Request } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth';
import { EMAIL_IMAGE_MAX_BYTES, EMAIL_IMAGE_MIME_TYPES, uploadEmailImage } from '../controllers/emailImageController';

type MulterOptions = NonNullable<Parameters<typeof multer>[0]>;
type FileFilterCallback = {
  (error: Error): void;
  (error: null, acceptFile: boolean): void;
};

const uploadOptions: MulterOptions = {
  storage: multer.memoryStorage(),
  limits: { fileSize: EMAIL_IMAGE_MAX_BYTES, files: 1 },
  // Anything else is dropped, so req.file is empty and the controller answers 400
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    cb(null, (EMAIL_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype));
  }
};

const upload = multer(uploadOptions);

const router: RouterType = Router();

router.use(authenticate);

/**
 * @swagger
 * /email-images:
 *   post:
 *     tags: [Broadcasts]
 *     summary: Upload an image for an email (admin)
 *     description: |
 *       Stores the image on Cloudinary and returns its public URL for use in a broadcast or template.
 *       JPEG, PNG, GIF or WebP, max 5 MB. Images don't appear on the Documents page and can't be deleted,
 *       so emails already sent keep showing them.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     url: { type: string, description: 'Public https URL — use as the img src' }
 *                     public_id: { type: string }
 *                     width: { type: integer, nullable: true }
 *                     height: { type: integer, nullable: true }
 *                     format: { type: string, nullable: true }
 *                     bytes: { type: integer }
 *       400: { description: No image, or not JPEG/PNG/GIF/WebP }
 *       413: { description: Larger than 5 MB }
 */
router.post('/', authorize('admin'), upload.single('image'), uploadEmailImage);

export default router;
