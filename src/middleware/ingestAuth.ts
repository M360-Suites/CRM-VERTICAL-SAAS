import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { Organization, IOrganization } from '../models/Organization';

export interface IngestRequest extends Request {
  organization?: IOrganization;
}

const timingSafeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * Authenticate server-to-server ingest calls with the organization's secret key
 * (sk_live_*) in the x-ingest-secret header. Never accepted from the body or query
 * so the key doesn't end up in logs or browser code.
 */
export const authenticateIngestSecret = async (
  req: IngestRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const provided = req.headers['x-ingest-secret'];
    if (typeof provided !== 'string' || !provided.startsWith('sk_live_')) {
      res.status(401).json({ status: false, message: 'Invalid credentials' });
      return;
    }

    const organization = await Organization.findOne({ secretKey: provided, is_active: true }).select(
      '_id name slug is_active secretKey'
    );

    if (!organization?.secretKey || !timingSafeEqual(provided, organization.secretKey)) {
      res.status(401).json({ status: false, message: 'Invalid credentials' });
      return;
    }

    req.organization = organization;
    next();
  } catch {
    res.status(500).json({ status: false, message: 'Authentication failed' });
  }
};
