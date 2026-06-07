/**
 * Type definitions for the CRM API
 * Common types used across the application
 */
import { Request } from 'express';
import { Readable } from 'stream';

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
  stream: Readable;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organization_id: string;
    display_name?: string;
  };
  file?: MulterFile;
}

/**
 * Paginated response structure
 * Standard response format for list endpoints
 */
export interface PaginatedResponse<T> {
  status: boolean;
  message: string;
  data: {
    data: T[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/**
 * Generic API response structure
 * Standard response format for all endpoints
 */
export interface ApiResponse<T = unknown> {
  status: boolean;
  message: string;
  data?: T;
  pagination?: PaginationMeta;
  errors?: string[];
}
