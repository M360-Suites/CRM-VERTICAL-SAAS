import { Request, Response, NextFunction } from 'express';
import { Organization, IOrganization } from '../models/Organization';

export interface PublicKeyRequest extends Request {
  organization?: IOrganization;
}

/**
 * Authenticate requests using a public key (pk_live_*)
 * Used for public lead capture endpoints (script tags, embeds)
 */
export const authenticatePublicKey = async (
  req: PublicKeyRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const publicKey = req.body.key || req.headers['x-api-key'];

    if (!publicKey || typeof publicKey !== 'string') {
      res.status(401).json({
        status: false,
        message: 'API key is required'
      });
      return;
    }

    if (!publicKey.startsWith('pk_live_')) {
      res.status(401).json({
        status: false,
        message: 'Invalid API key format'
      });
      return;
    }

    const organization = await Organization.findOne({
      publicKey,
      is_active: true
    }).select('_id name slug is_active publicKey');

    if (!organization) {
      res.status(401).json({
        status: false,
        message: 'Invalid or inactive API key'
      });
      return;
    }

    req.organization = organization;
    next();
  } catch (error) {
    console.error('Public key auth error:', error);
    res.status(500).json({
      status: false,
      message: 'Authentication failed'
    });
  }
};
