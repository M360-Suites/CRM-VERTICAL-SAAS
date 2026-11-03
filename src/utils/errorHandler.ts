/**
 * Centralised error handling
 * Turns thrown errors (Mongoose, MongoDB, JWT, Multer, body-parser, AppError)
 * into consistent, descriptive JSON responses:
 *
 *   { status: false, message, code, errors?, detail? }
 *
 * `detail` (the raw error message) is only included outside production.
 */
import { Response } from 'express';
import { logger } from '../config/logger';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'INVALID_ID'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_KEY'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_JSON'
  | 'FILE_UPLOAD_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** Throw this from controllers/services to return a specific status + message */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly errors?: string[];

  constructor(statusCode: number, message: string, code?: ErrorCode, errors?: string[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeForStatus(statusCode);
    this.errors = errors;
  }
}

export interface ClassifiedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  errors?: string[];
}

const defaultCodeForStatus = (status: number): ErrorCode => {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 413: return 'PAYLOAD_TOO_LARGE';
    case 503: return 'SERVICE_UNAVAILABLE';
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
};

const humanizeField = (field: string): string => field.replace(/_/g, ' ');

const formatValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      return json.length > 80 ? `${json.slice(0, 77)}...` : json;
    } catch {
      return String(value);
    }
  }
  const str = String(value);
  return str.length > 80 ? `${str.slice(0, 77)}...` : str;
};

type ErrorLike = Error & Record<string, unknown>;

const isErrorLike = (error: unknown): error is ErrorLike =>
  typeof error === 'object' && error !== null && ('name' in error || 'message' in error);

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: 'The uploaded file is too large',
  LIMIT_FILE_COUNT: 'Too many files were uploaded at once',
  LIMIT_FIELD_COUNT: 'Too many form fields were submitted',
  LIMIT_FIELD_KEY: 'A form field name is too long',
  LIMIT_FIELD_VALUE: 'A form field value is too long',
  LIMIT_PART_COUNT: 'The upload contains too many parts',
  LIMIT_UNEXPECTED_FILE: 'An unexpected file field was received'
};

/**
 * Classify an unknown error. Returns null when the error is not recognised,
 * meaning it should be treated as an internal server error.
 */
export const classifyError = (error: unknown): ClassifiedError | null => {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message, errors: error.errors };
  }

  if (!isErrorLike(error)) return null;

  const name = String(error.name ?? '');

  // Mongoose: invalid ObjectId / cast failure, e.g. GET /deals/not-an-id
  if (name === 'CastError') {
    const path = String(error.path ?? 'value');
    const kind = String(error.kind ?? 'value');
    const expected = kind === 'ObjectId' ? 'a valid ID (24-character hex string)' : `a valid ${kind}`;
    return {
      statusCode: 400,
      code: 'INVALID_ID',
      message: `Invalid ${humanizeField(path)}: "${formatValue(error.value)}" is not ${expected}`
    };
  }

  // Mongoose schema validation failure
  if (name === 'ValidationError' && error.errors && typeof error.errors === 'object') {
    const fieldErrors = Object.values(error.errors as Record<string, ErrorLike>).map((fieldError) => {
      if (fieldError?.name === 'CastError') {
        return `${humanizeField(String(fieldError.path))} has an invalid value "${formatValue(fieldError.value)}"`;
      }
      const kind = String(fieldError?.kind ?? '');
      const path = humanizeField(String(fieldError?.path ?? 'field'));
      if (kind === 'required') return `${path} is required`;
      if (kind === 'enum') {
        const allowed = (fieldError?.properties as { enumValues?: unknown[] } | undefined)?.enumValues;
        return Array.isArray(allowed) && allowed.length
          ? `${path} must be one of: ${allowed.join(', ')}`
          : `${path} has an invalid value`;
      }
      return String(fieldError?.message ?? `${path} is invalid`);
    });
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: fieldErrors.length === 1 ? `Validation failed: ${fieldErrors[0]}` : 'Validation failed',
      errors: fieldErrors
    };
  }

  if (name === 'StrictModeError') {
    return { statusCode: 400, code: 'VALIDATION_ERROR', message: String(error.message) };
  }

  if (name === 'DocumentNotFoundError') {
    return { statusCode: 404, code: 'NOT_FOUND', message: 'The requested record no longer exists' };
  }

  if (name === 'VersionError') {
    return {
      statusCode: 409,
      code: 'CONFLICT',
      message: 'This record was modified by someone else. Refresh and try again.'
    };
  }

  // MongoDB duplicate key (unique index)
  if (error.code === 11000 || error.code === 11001) {
    const keyValue = (error.keyValue ?? {}) as Record<string, unknown>;
    const fields = Object.keys(keyValue).filter((key) => key !== 'organization_id');
    if (fields.length > 0) {
      const description = fields.map((field) => `${humanizeField(field)} "${formatValue(keyValue[field])}"`).join(' and ');
      return {
        statusCode: 409,
        code: 'DUPLICATE_KEY',
        message: `A record with ${description} already exists`
      };
    }
    return { statusCode: 409, code: 'DUPLICATE_KEY', message: 'A record with these details already exists' };
  }

  // Database connectivity problems
  if (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoNotConnectedError'
  ) {
    return {
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The database is temporarily unavailable. Please try again in a moment.'
    };
  }

  // JWT
  if (name === 'TokenExpiredError') {
    return { statusCode: 401, code: 'TOKEN_EXPIRED', message: 'Your session has expired. Please log in again.' };
  }
  if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
    return { statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid authentication token. Please log in again.' };
  }

  // Multer upload errors
  if (name === 'MulterError') {
    const multerCode = String(error.code ?? '');
    const field = error.field ? ` (field "${String(error.field)}")` : '';
    return {
      statusCode: multerCode === 'LIMIT_FILE_SIZE' ? 413 : 400,
      code: multerCode === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'FILE_UPLOAD_ERROR',
      message: `${MULTER_MESSAGES[multerCode] ?? 'File upload failed'}${field}`
    };
  }

  // body-parser / http-errors style errors (express.json etc.)
  const status = Number(error.status ?? error.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    if (error.type === 'entity.parse.failed') {
      return {
        statusCode: 400,
        code: 'INVALID_JSON',
        message: 'The request body is not valid JSON. Check for trailing commas, unquoted keys or mismatched brackets.'
      };
    }
    if (error.type === 'entity.too.large' || status === 413) {
      return {
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large. The maximum allowed size is 1MB.'
      };
    }
    if (error.expose === true && typeof error.message === 'string' && error.message) {
      return { statusCode: status, code: defaultCodeForStatus(status), message: error.message };
    }
  }

  return null;
};

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Build the JSON body for an error response */
export const buildErrorBody = (
  error: unknown,
  fallbackMessage: string
): { statusCode: number; body: Record<string, unknown> } => {
  const classified = classifyError(error);

  if (classified) {
    const body: Record<string, unknown> = {
      status: false,
      message: classified.message,
      code: classified.code
    };
    if (classified.errors?.length) body.errors = classified.errors;
    return { statusCode: classified.statusCode, body };
  }

  const body: Record<string, unknown> = {
    status: false,
    message: `${fallbackMessage.replace(/\.$/, '')}. An unexpected server error occurred; please try again, and contact support if it keeps happening.`,
    code: 'INTERNAL_ERROR'
  };
  if (!isProduction() && isErrorLike(error) && error.message) {
    body.detail = String(error.message);
  }
  return { statusCode: 500, body };
};

/**
 * Send a descriptive error response.
 * Known errors (bad IDs, validation, duplicates, auth, uploads…) get a 4xx with a
 * specific message; anything else is logged and returned as a 500 that names
 * the operation that failed (`fallbackMessage`, e.g. "Failed to update deal").
 */
export const handleError = (res: Response, error: unknown, fallbackMessage: string): void => {
  const { statusCode, body } = buildErrorBody(error, fallbackMessage);

  if (statusCode >= 500) {
    logger.error({ err: error }, fallbackMessage);
  } else {
    logger.warn({ err: error, statusCode }, `${fallbackMessage}: ${String(body.message)}`);
  }

  if (res.headersSent) return;
  res.status(statusCode).json(body);
};
