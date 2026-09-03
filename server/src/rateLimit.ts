/**
 * Rate limiting.
 *
 * There was none. With one athlete and a token in his own keychain that was a
 * reasonable place to stop; with a handful of people it is the difference
 * between a bug in a retry loop costing a wasted afternoon and costing a bill.
 *
 * Deliberately in memory. One box, single process — a Redis for this would be
 * more moving parts than the problem has, and the failure mode of losing the
 * counters on a restart is that somebody gets a fresh minute. When there is a
 * second process, this is the file that has to change, and it says so.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors';

export type Limit = {
  /** Requests allowed in the window. */
  max: number;
  windowMs: number;
};

/** Generous: a phone draining a sync queue makes a burst of legitimate calls. */
export const API_LIMIT: Limit = { max: 240, windowMs: 60_000 };

/**
 * The model costs money and takes seconds. Tighter, and separate, so that a
 * chat loop cannot lock somebody out of logging a set.
 */
export const LLM_LIMIT: Limit = { max: 40, windowMs: 60 * 60_000 };

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Called on a timer so a long-running process does not accumulate keys. */
export function sweepBuckets(now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type Verdict = { ok: boolean; remaining: number; retryAfterSeconds: number };

export function take(key: string, limit: Limit, now = Date.now()): Verdict {
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, remaining: limit.max - 1, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
  if (bucket.count >= limit.max) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit.max - bucket.count, retryAfterSeconds };
}

/** Reset between tests, and after a deploy. */
export function resetBuckets(): void {
  buckets.clear();
}

function enforce(request: FastifyRequest, name: string, limit: Limit): void {
  // Before auth resolves a user there is nobody to limit but the address.
  const who = request.ctx?.userId ?? request.ip;
  const verdict = take(`${name}:${who}`, limit);

  if (!verdict.ok) {
    throw new HttpError(
      429,
      name === 'llm'
        ? 'You have asked the trainer a lot in the last hour. Give it a few minutes — ' +
          'logging and your numbers are unaffected.'
        : name === 'auth'
          ? 'Too many sign-in attempts. Try again later.'
          : 'Too many requests. Try again in a moment.',
    );
  }
}

/**
 * Sign-in, which is unauthenticated and therefore keyed by address. Tight:
 * nobody signs in twenty times an hour, and this is the one door a stranger
 * can knock on.
 */
export const AUTH_LIMIT: Limit = { max: 20, windowMs: 60 * 60_000 };

const AUTH_PATHS = ['/auth/apple', '/auth/apple/nonce'];

/** Paths that reach the model, and are therefore metered separately. */
const LLM_PATHS = [
  '/chat',
  '/coach/today',
  '/foods/estimate',
  '/fridge/read',
  '/fridge/plan',
  '/review/generate',
];

export function registerRateLimit(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (request.url === '/health') return;

    enforce(request, 'api', API_LIMIT);

    const path = request.url.split('?')[0] ?? request.url;
    if (request.method === 'POST' && AUTH_PATHS.includes(path)) {
      enforce(request, 'auth', AUTH_LIMIT);
    }

    if (request.method === 'POST' && LLM_PATHS.includes(path)) {
      enforce(request, 'llm', LLM_LIMIT);
    }
  });

  const timer = setInterval(() => sweepBuckets(), 5 * 60_000);
  timer.unref();
}
