import { Response } from 'express';
import mongoose from 'mongoose';
import { CRMFile } from '../models/Document';
import { Folder } from '../models/Folder';
import { AuthRequest } from '../types';
import cloudinary from '../config/cloudinary';
import { requireOrganization } from '../utils/tenant';

type FolderModifier = {
  _id: mongoose.Types.ObjectId;
  email?: string;
  display_name?: string;
};

const getUserObjectId = (req: AuthRequest): mongoose.Types.ObjectId | undefined => (
  req.user?.id && mongoose.Types.ObjectId.isValid(req.user.id)
    ? new mongoose.Types.ObjectId(req.user.id)
    : undefined
);

const asTrimmedString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
};

const getUploadedFiles = (req: AuthRequest): Express.Multer.File[] => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;

  const filesByField = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (!filesByField) return [];

  return [
    ...(filesByField.documents || []),
    ...(filesByField.document || []),
    ...(filesByField.file || [])
  ];
};

const extensionMap: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/bmp': 'bmp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

const getDocumentExtension = (mimeType: string): string => {
  const ext = extensionMap[mimeType];
  return ext ? `.${ext}` : '';
};

const getDocumentFormat = (mimeType: string): string => extensionMap[mimeType] || 'raw';

const getCloudinaryResourceType = (mimeType: string): 'image' | 'video' | 'raw' => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return 'video';
  return 'raw';
};

const getStoredDocumentResourceType = (document: { mime_type: string; cloudinary_url?: string }): 'image' | 'video' | 'raw' => {
  if (document.cloudinary_url?.includes('/raw/upload/')) return 'raw';
  if (document.cloudinary_url?.includes('/image/upload/')) return 'image';
  if (document.cloudinary_url?.includes('/video/upload/')) return 'video';
  return getCloudinaryResourceType(document.mime_type);
};

const getCloudinaryPublicId = (mimeType: string): string => {
  const baseName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = getDocumentExtension(mimeType);
  return ext ? `${baseName}${ext}` : baseName;
};

const touchFolder = async (
  folderId: mongoose.Types.ObjectId | string | null | undefined,
  organizationId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId
): Promise<void> => {
  if (!folderId) return;

  await Folder.findOneAndUpdate(
    { _id: folderId, organization_id: organizationId },
    { last_modified_by: userId },
    { timestamps: true }
  );
};

export const getFolders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const folders = await Folder.aggregate([
      { $match: { organization_id: organizationId } },
      {
        $lookup: {
          from: 'users',
          localField: 'last_modified_by',
          foreignField: '_id',
          as: 'last_modified_by_user'
        }
      },
      {
        $lookup: {
          from: 'crmfiles',
          let: { folderId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$folder_id', '$$folderId'] },
                    { $eq: ['$organization_id', organizationId] }
                  ]
                }
              }
            },
            { $count: 'count' }
          ],
          as: 'documents'
        }
      },
      {
        $addFields: {
          document_count: { $ifNull: [{ $first: '$documents.count' }, 0] },
          last_modified_by: {
            $let: {
              vars: { user: { $first: '$last_modified_by_user' } },
              in: {
                _id: '$$user._id',
                email: '$$user.email',
                display_name: '$$user.display_name'
              }
            }
          }
        }
      },
      { $project: { documents: 0, last_modified_by_user: 0 } },
      { $sort: { created_at: -1 } }
    ]);

    res.json({
      status: true,
      message: 'Folders retrieved successfully',
      data: folders
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch folders' });
  }
};

export const getFolderById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      res.status(400).json({ status: false, message: 'Invalid folder ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const folder = await Folder.findOne({ _id: folderId, organization_id: organizationId })
      .populate('owner_id', 'email display_name')
      .populate('last_modified_by', 'email display_name')
      .lean();

    if (!folder) {
      res.status(404).json({ status: false, message: 'Folder not found' });
      return;
    }

    const documents = await CRMFile.find({
      folder_id: new mongoose.Types.ObjectId(folderId),
      organization_id: organizationId
    })
      .populate('owner_id', 'email display_name')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'Folder retrieved successfully',
      data: {
        ...folder,
        document_count: documents.length,
        documents
      }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch folder' });
  }
};

export const createFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = asTrimmedString(req.body?.name, 120);
    const description = asTrimmedString(req.body?.description, 500);

    if (!name) {
      res.status(400).json({ status: false, message: 'Folder name is required' });
      return;
    }

    const ownerId = getUserObjectId(req);
    if (!ownerId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const folder = await Folder.create({
      name,
      description,
      owner_id: ownerId,
      last_modified_by: ownerId,
      organization_id: organizationId
    });

    res.status(201).json({
      status: true,
      message: 'Folder created successfully',
      data: folder
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to create folder' });
  }
};

export const updateFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      res.status(400).json({ status: false, message: 'Invalid folder ID' });
      return;
    }

    const update: Record<string, unknown> = {};

    if (req.body?.name !== undefined) {
      const name = asTrimmedString(req.body.name, 120);
      if (!name) {
        res.status(400).json({ status: false, message: 'Folder name is required' });
        return;
      }
      update.name = name;
    }

    if (req.body?.description !== undefined) {
      update.description = asTrimmedString(req.body.description, 500) || '';
    }

    const userId = getUserObjectId(req);
    if (!userId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    update.last_modified_by = userId;

    const folder = await Folder.findOneAndUpdate(
      { _id: folderId, organization_id: organizationId },
      update,
      { new: true, runValidators: true }
    )
      .populate('last_modified_by', 'email display_name')
      .lean();

    if (!folder) {
      res.status(404).json({ status: false, message: 'Folder not found' });
      return;
    }

    res.json({
      status: true,
      message: 'Folder updated successfully',
      data: folder
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update folder' });
  }
};

export const deleteFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      res.status(400).json({ status: false, message: 'Invalid folder ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const folder = await Folder.findOne({ _id: folderId, organization_id: organizationId });
    if (!folder) {
      res.status(404).json({ status: false, message: 'Folder not found' });
      return;
    }

    const documents = await CRMFile.find({ folder_id: folderId, organization_id: organizationId }).lean();
    await Promise.all(documents.map((document) => cloudinary.uploader.destroy(document.cloudinary_public_id)));
    await CRMFile.deleteMany({ folder_id: folderId, organization_id: organizationId });
    await Folder.findOneAndDelete({ _id: folderId, organization_id: organizationId });

    res.json({
      status: true,
      message: 'Folder deleted successfully',
      data: { deleted_documents: documents.length }
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to delete folder' });
  }
};

export const uploadDocumentsToFolder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      res.status(400).json({ status: false, message: 'Invalid folder ID' });
      return;
    }

    const files = getUploadedFiles(req);
    if (files.length === 0) {
      res.status(400).json({ status: false, message: 'No documents provided' });
      return;
    }

    const ownerId = getUserObjectId(req);
    if (!ownerId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const userId = getUserObjectId(req);
    if (!userId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const folder = await Folder.findOne({ _id: folderId, organization_id: organizationId }).lean();
    if (!folder) {
      res.status(404).json({ status: false, message: 'Folder not found' });
      return;
    }

    const documents = await Promise.all(files.map(async (file) => {
      const publicId = getCloudinaryPublicId(file.mimetype);
      const resourceType = getCloudinaryResourceType(file.mimetype);
      const result = await cloudinary.uploader.upload(
        `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
        {
          resource_type: resourceType,
          public_id: publicId,
          folder: 'crm/documents'
        }
      );

      return CRMFile.create({
        original_name: file.originalname,
        stored_name: result.public_id,
        mime_type: file.mimetype,
        file_size: file.size,
        cloudinary_url: result.secure_url,
        cloudinary_public_id: result.public_id,
        folder_id: new mongoose.Types.ObjectId(folderId),
        owner_id: ownerId,
        organization_id: organizationId,
        tags: []
      });
    }));

    await touchFolder(folderId, organizationId, userId);

    res.status(201).json({
      status: true,
      message: 'Documents uploaded successfully',
      data: documents
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to upload documents' });
  }
};

export const getFolderDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { folderId } = req.params as { folderId: string };

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      res.status(400).json({ status: false, message: 'Invalid folder ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const folder = await Folder.exists({ _id: folderId, organization_id: organizationId });
    if (!folder) {
      res.status(404).json({ status: false, message: 'Folder not found' });
      return;
    }

    const documents = await CRMFile.find({
      folder_id: new mongoose.Types.ObjectId(folderId),
      organization_id: organizationId
    })
      .populate('owner_id', 'email display_name')
      .populate('folder_id', 'name description')
      .sort({ created_at: -1 })
      .lean();

    res.json({
      status: true,
      message: 'Folder documents retrieved successfully',
      data: documents
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to fetch folder documents' });
  }
};

export const downloadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params as { documentId: string };

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      res.status(400).json({ status: false, message: 'Invalid document ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const document = await CRMFile.findOne({ _id: documentId, organization_id: organizationId }).lean();
    if (!document) {
      res.status(404).json({ status: false, message: 'Document not found' });
      return;
    }

    const downloadUrl = cloudinary.utils.private_download_url(
      document.cloudinary_public_id,
      getDocumentFormat(document.mime_type),
      {
        resource_type: getStoredDocumentResourceType(document),
        type: 'upload',
        expires_at: Math.floor(Date.now() / 1000) + 300,
        attachment: true
      }
    );

    res.redirect(downloadUrl);
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to download document' });
  }
};

export const updateDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params as { documentId: string };

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      res.status(400).json({ status: false, message: 'Invalid document ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const update: Record<string, unknown> = {};

    if (req.body?.name !== undefined) {
      const name = asTrimmedString(req.body.name, 180);
      if (!name) {
        res.status(400).json({ status: false, message: 'Document name is required' });
        return;
      }
      update.original_name = name;
    }

    if (req.body?.notes !== undefined) {
      update.notes = asTrimmedString(req.body.notes, 1000) || '';
    }

    if (req.body?.tags !== undefined) {
      update.tags = Array.isArray(req.body.tags)
        ? req.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
        : String(req.body.tags).split(',').map((tag) => tag.trim()).filter(Boolean);
    }

    if (req.body?.folder_id !== undefined) {
      const folderId = asTrimmedString(req.body.folder_id, 80);
      if (!folderId || !mongoose.Types.ObjectId.isValid(folderId)) {
        res.status(400).json({ status: false, message: 'Invalid folder ID' });
        return;
      }

      const folderExists = await Folder.exists({ _id: folderId, organization_id: organizationId });
      if (!folderExists) {
        res.status(404).json({ status: false, message: 'Folder not found' });
        return;
      }

      update.folder_id = new mongoose.Types.ObjectId(folderId);
    }

    const userId = getUserObjectId(req);
    if (!userId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const document = await CRMFile.findOneAndUpdate(
      { _id: documentId, organization_id: organizationId },
      update,
      { new: true, runValidators: true }
    )
      .populate('folder_id', 'name description')
      .lean();

    if (!document) {
      res.status(404).json({ status: false, message: 'Document not found' });
      return;
    }

    await touchFolder(
      (document.folder_id as FolderModifier | mongoose.Types.ObjectId | undefined)?._id || document.folder_id,
      organizationId,
      userId
    );

    res.json({
      status: true,
      message: 'Document updated successfully',
      data: document
    });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to update document' });
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { documentId } = req.params as { documentId: string };

    if (!mongoose.Types.ObjectId.isValid(documentId)) {
      res.status(400).json({ status: false, message: 'Invalid document ID' });
      return;
    }

    const organizationId = requireOrganization(req, res);
    if (!organizationId) return;

    const userId = getUserObjectId(req);
    if (!userId) {
      res.status(401).json({ status: false, message: 'Unauthorized' });
      return;
    }

    const document = await CRMFile.findOne({ _id: documentId, organization_id: organizationId });
    if (!document) {
      res.status(404).json({ status: false, message: 'Document not found' });
      return;
    }

    await cloudinary.uploader.destroy(document.cloudinary_public_id);
    await CRMFile.findOneAndDelete({ _id: documentId, organization_id: organizationId });
    await touchFolder(document.folder_id, organizationId, userId);

    res.json({ status: true, message: 'Document deleted successfully' });
  } catch (error) {
    res.status(500).json({ status: false, message: 'Failed to delete document' });
  }
};
