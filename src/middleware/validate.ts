import { Request, Response, NextFunction } from 'express';

type FieldRule = {
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array';
  minLength?: number;
  maxLength?: number;
  enum?: readonly string[];
};

type Schema = Record<string, FieldRule>;

export const validateBody = (schema: Schema) => (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors: string[] = [];

  for (const [field, rule] of Object.entries(schema)) {
    const value = req.body?.[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (rule.type === 'array') {
      if (!Array.isArray(value)) errors.push(`${field} must be an array (received ${actualType})`);
    } else if (rule.type && typeof value !== rule.type) {
      errors.push(`${field} must be a ${rule.type} (received ${actualType})`);
    }

    if (typeof value === 'string') {
      if (rule.minLength && value.length < rule.minLength) {
        errors.push(`${field} must be at least ${rule.minLength} characters long (received ${value.length})`);
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        errors.push(`${field} must be at most ${rule.maxLength} characters long (received ${value.length})`);
      }
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rule.enum.join(', ')} (received "${value}")`);
      }
    }
  }

  if (errors.length > 0) {
    res.status(400).json({
      status: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors
    });
    return;
  }

  next();
};
