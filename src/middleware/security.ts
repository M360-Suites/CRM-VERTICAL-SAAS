import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 300;
const MAX_AUTH_FAILURES = 30;
const MAX_PUBLIC_LEAD_REQUESTS = 100;

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Drop expired buckets so the map doesn't grow forever */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS).unref();

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};

const clientIp = (req: Request): string => req.ip || req.socket.remoteAddress || 'unknown';

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Pulls the session token from the Authorization header or the crm_AT/token
 * cookie. Runs before cookie-parser, so the Cookie header is read raw.
 */
const sessionToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7) || null;

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)(?:crm_AT|token)=([^;]+)/);
  return match ? match[1] : null;
};

/** Returns true if the request may proceed; counts it against the bucket */
const hit = (key: string, max: number): boolean => {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (bucket.count >= max) return false;

  bucket.count += 1;
  return true;
};

const refund = (key: string): void => {
  const bucket = buckets.get(key);
  if (bucket && bucket.count > 0) bucket.count -= 1;
};

/**
 * Global limiter. Logged-in traffic is bucketed per user (verified JWT), not per
 * IP: the web app calls the API through its server-side proxy, so every
 * user shares the proxy's IP and one busy tenant would 429 everyone.
 */
export const rateLimit = (req: Request, res: Response, next: NextFunction): void => {
  let key = `ip:${clientIp(req)}`;
  const token = sessionToken(req);
  if (token) {
    try {
      key = `user:${verifyToken(decodeURIComponent(token)).id}`;
    } catch {
      // invalid/expired token: fall back to the IP bucket
    }
  }

  if (!hit(key, MAX_REQUESTS)) {
    res.status(429).json({ status: false, message: 'Too many requests. Please try again later.' });
    return;
  }

  next();
};

/**
 * Brute-force guard for auth endpoints. Counts only failed attempts, keyed
 * by IP + email when the body has one, so a user who logs in successfully
 * never burns budget and one person's typos can't lock out everyone else
 * coming through the same proxy IP.
 */
export const authRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const rawEmail = (req.body as { email?: unknown } | undefined)?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const key = `auth:${req.path}:${clientIp(req)}:${email ? shortHash(email) : '-'}`;

  if (!hit(key, MAX_AUTH_FAILURES)) {
    res.status(429).json({ status: false, message: 'Too many auth attempts. Please try again later.' });
    return;
  }

  res.on('finish', () => {
    if (res.statusCode < 400) refund(key);
  });

  next();
};

export const publicLeadRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  if (!hit(`public-lead:${clientIp(req)}`, MAX_PUBLIC_LEAD_REQUESTS)) {
    res.status(429).json({ status: false, message: 'Too many requests. Please try again later.' });
    return;
  }

  next();
};
