/**
 * Email images — pictures used inside broadcasts and email templates.
 * Mail clients only show images they can download from a public URL, so each
 * upload goes to Cloudinary (per-organization folder) and the public URL is
 * returned for the editor to put in an <img src>.
 *
 * Deliberately separate from Documents: these files never appear on the
 * Documents page, and there is no delete endpoint, because removing an image
 * would break it in every email already sent.
 */
import { Response } from 'express';
import { AuthRequest } from '../types';
import cloudinary from '../config/cloudinary';
import { requireOrganization } from '../utils/tenant';
import { handleError } from '../utils/errorHandler';

/** Formats every major mail client renders. SVG is excluded: Gmail and Outlook block it. */
export const EMAIL_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const EMAIL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /email-images — multipart/form-data with one file in the `image` field
 */
export const uploadEmailImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const file = req.file;
    if (!file) {
      res.status(400).json({
        status: false,
        message: `Attach an image in the "image" field (${EMAIL_IMAGE_MIME_TYPES.map((type) => type.replace('image/', '')).join(', ')}, max 5 MB)`
      });
      return;
    }

    const result = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
      resource_type: 'image',
      folder: `crm/email-images/${organizationId.toString()}`,
      // Unguessable names: the URL is public, so it shouldn't be enumerable
      use_filename: false,
      unique_filename: true
    });

    res.status(201).json({
      status: true,
      message: 'Image uploaded',
      data: {
        url: result.secure_url,
        public_id: result.public_id,
        width: result.width ?? null,
        height: result.height ?? null,
        format: result.format ?? null,
        bytes: result.bytes ?? file.size
      }
    });
  } catch (error) {
    handleError(res, error, 'Failed to upload image');
  }
};
