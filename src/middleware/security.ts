import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 300;
const buckets = new Map<string, { count: number; resetAt: number }>();

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};

export const rateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= MAX_REQUESTS) {
    res.status(429).json({ status: false, message: 'Too many requests. Please try again later.' });
    return;
  }

  bucket.count += 1;
  next();
};

export const authRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const key = `auth:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= 30) {
    res.status(429).json({ status: false, message: 'Too many auth attempts. Please try again later.' });
    return;
  }

  bucket.count += 1;
  next();
};

export const publicLeadRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const key = `public-lead:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= 100) {
    res.status(429).json({ status: false, message: 'Too many requests. Please try again later.' });
    return;
  }

  bucket.count += 1;
  next();
};
