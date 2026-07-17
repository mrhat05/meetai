import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { createManagedRedis } from '../src/queue/connection.js';

/**
 * Redis sliding-window rate limiter (hand-rolled — the point is being able to
 * whiteboard it, not to import `express-rate-limit`).
 *
 * Algorithm, per key, in one MULTI (atomic, one round trip):
 *   ZADD key now <member>            -- record this hit
 *   ZREMRANGEBYSCORE key 0 windowStart  -- evict hits older than the window
 *   ZCARD key                        -- how many hits remain in the window
 *   PEXPIRE key windowMs             -- let idle keys self-clean
 * The ZCARD counts THIS request too, so we block when count > max.
 *
 * Design choices worth defending:
 *  - Sliding window (not fixed window) — no 2× burst at window boundaries.
 *  - Fail-OPEN: if Redis is unreachable we call next(). For login/OTP/ask
 *    endpoints, availability beats strictness — a Redis blip must not lock
 *    everyone out. That's why we use a fail-fast client (see below).
 *  - Disabled under NODE_ENV=test so the deterministic suite isn't throttled.
 */

const DISABLED = process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === '1';

let client: Redis | null = null;
function getClient(): Redis | null {
  if (DISABLED) return null;
  if (!client) {
    // enableOfflineQueue:false + commandTimeout make commands reject quickly
    // when Redis is down/slow, so the catch below can fail-open instead of the
    // request hanging.
    client = createManagedRedis({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
    });
  }
  return client;
}

type KeyBy = 'ip' | 'user';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  /** Namespaces the Redis keys so different route families don't share a budget. */
  prefix: string;
  /** 'ip' for pre-auth routes, 'user' for authenticated routes (needs authMiddleware first). */
  by?: KeyBy;
};

function identify(req: Request, by: KeyBy): string {
  if (by === 'user') return req.user?.userId ?? req.ip ?? 'unknown';
  return req.ip ?? 'unknown';
}

export function rateLimit({ windowMs, max, prefix, by = 'ip' }: RateLimitOptions) {
  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const redis = getClient();
    if (!redis) return next();

    const key = `rl:${prefix}:${identify(req, by)}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    try {
      const results = await redis
        .multi()
        .zadd(key, now, member)
        .zremrangebyscore(key, 0, windowStart)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec();

      // results[2] corresponds to ZCARD → [error, count].
      const count = Number(results?.[2]?.[1] ?? 0);

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        const retryAfterSec = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          error: 'Too many requests. Please slow down and try again in a moment.',
        });
      }

      return next();
    } catch {
      // Fail open — never let a Redis hiccup take down auth.
      return next();
    }
  };
}

// Shared presets. Route families get distinct prefixes so they don't starve
// each other's budgets.
export const authRateLimit = rateLimit({ windowMs: 60_000, max: 5, prefix: 'auth', by: 'ip' });
export const otpRateLimit = rateLimit({ windowMs: 60_000, max: 10, prefix: 'otp', by: 'ip' });
export const askRateLimit = rateLimit({ windowMs: 60_000, max: 10, prefix: 'ask', by: 'user' });
