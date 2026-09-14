import { NextFunction, Response } from 'express';
import { PublicKeyRequest } from './publicAuth';
import { Site } from '../models/Site';
import { logger } from '../config/logger';

const HTTP_PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//i;

const normalizeDomain = (raw: string): string | null => {
  if (!raw || typeof raw !== 'string') return null;

  const withoutPath = raw.split(/[/?#]/)[0] || '';
  let domain = withoutPath.replace(HTTP_PROTOCOL, '').trim();

  if (!domain) return null;

  domain = domain.toLowerCase();

  if (domain.startsWith('www.')) domain = domain.slice(4);

  if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*(\.[a-z]{2,})?$/.test(domain)) return null;

  return domain;
};

const extractDomain = (req: PublicKeyRequest): { domain: string; source: 'explicit' | 'header' } | null => {
  const explicit = (req.body as Record<string, unknown> | undefined)?.site ?? (req.body as Record<string, unknown> | undefined)?.domain;
  if (typeof explicit === 'string') {
    const domain = normalizeDomain(explicit);
    if (domain) return { domain, source: 'explicit' };
  }

  const referer = req.headers.referer || req.headers.referrer;
  const origin = req.headers.origin;

  const headerValue = typeof referer === 'string' ? referer : typeof origin === 'string' ? origin : undefined;
  if (headerValue) {
    const domain = normalizeDomain(headerValue);
    if (domain) return { domain, source: 'header' };
  }

  return null;
};

/**
 * Records which site (domain) made a public-key authenticated request.
 * Fire-and-forget: failures never block or fail the main request.
 */
export const trackSite = async (req: PublicKeyRequest, _res: Response, next: NextFunction): Promise<void> => {
  next();

  if (!req.organization) return;

  const detected = extractDomain(req);
  if (!detected) return;

  try {
    const now = new Date();
    await Site.findOneAndUpdate(
      { organization_id: req.organization._id, domain: detected.domain },
      {
        $inc: { request_count: 1 },
        $set: { last_seen_at: now },
        $setOnInsert: { first_seen_at: now, source: detected.source, is_active: true }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    logger.error({ err: error, domain: detected.domain }, 'Failed to track site for public key');
  }
};