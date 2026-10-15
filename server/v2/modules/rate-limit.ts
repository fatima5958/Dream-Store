import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Small per-process guard for the isolated V2 staging server. Production must
 * use a shared edge/distributed limiter before any V2 traffic is considered.
 */
export function createProcessRateLimiter(options: {
  windowMs?: number; maxRequests?: number; maxMutationsPerRoute?: number; now?: () => number;
} = {}): RequestHandler {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 240;
  const maxMutationsPerRoute = options.maxMutationsPerRoute ?? 40;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const timestamp = now();
    for (const [key, bucket] of buckets) if (timestamp - bucket.start >= windowMs) buckets.delete(key);
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const keys = [`ip:${ip}`];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) keys.push(`mutation:${ip}:${req.path}`);
    let retryAfter = 0;
    for (const key of keys) {
      const bucket = buckets.get(key);
      const limit = key.startsWith('mutation:') ? maxMutationsPerRoute : maxRequests;
      if (bucket && bucket.count >= limit && timestamp - bucket.start < windowMs) {
        retryAfter = Math.max(retryAfter, Math.ceil((windowMs - (timestamp - bucket.start)) / 1000));
      }
    }
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({ code: 'request/rate-limited', error: 'Too many requests. Please wait before retrying.' });
      return;
    }
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket) bucket.count++;
      else buckets.set(key, { start: timestamp, count: 1 });
    }
    next();
  };
}
