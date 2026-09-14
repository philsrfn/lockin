/**
 * Rate limiting.
 *
 * There was none. With one athlete and a token in his own keychain that was a
 * reasonable place to stop; with a handful of people it is the difference
 * between a bug in a retry loop costing a wasted afternoon and costing a bill.
 *
 * There are two kinds of limit here, and they want different machinery.
 *
 * The `api` ceiling protects *one process* from a runaway phone. A second
 * worker brings its own capacity along with its own counter, so keeping it in
 * memory is not a compromise — it is the right shape, and it costs no query on
 * a path that runs for every set logged.
 *
 * The `llm` and `auth` ceilings guard something finite that every process
 * shares: money, and the one door a stranger can knock on. Those counters live
 * in Postgres (migration 032), because two workers each keeping their own turns
 * forty model calls an hour into eighty without anybody deciding to. The cost
 * is one round trip on paths that were already going to spend seconds in a
 * model or a signature check.
 *
 * Redis is still the wrong answer. There is a database on the same box, an
 * upsert is atomic, and a counter that can be read with psql when something
 * looks wrong is worth more here than one that cannot.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors';
import { query } from './db';
import { log } from './logging';

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

/**
 * The same decision as `take`, counted in Postgres so that every process
 * counts into the same bucket.
 *
 * One statement, because two would race: between a select and an update, a
 * second worker gets to spend the same allowance. `on conflict do update`
 * takes a row lock, so the count it returns is the count after this request,
 * whoever else was asking at the same moment.
 *
 * A request past the ceiling still increments. That is deliberate — it keeps
 * the statement one statement — and harmless, because the window's expiry is
 * left alone, so hammering a closed door does not hold it closed for longer.
 */
export async function takeShared(key: string, limit: Limit): Promise<Verdict> {
  const seconds = limit.windowMs / 1000;

  const rows = await query<{ count: number; reset_at: Date }>(
    `insert into rate_limits (key, count, reset_at)
     values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update
       set count = case when rate_limits.reset_at <= now() then 1
                        else rate_limits.count + 1 end,
           reset_at = case when rate_limits.reset_at <= now() then now() + make_interval(secs => $2)
                           else rate_limits.reset_at end
     returning count, reset_at`,
    [key, seconds],
  );

  const row = rows[0];
  // An upsert with `returning` always gives a row back; if it somehow did not,
  // letting the request through beats refusing everybody because of a limiter.
  if (!row) return { ok: true, remaining: limit.max - 1, retryAfterSeconds: 0 };

  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(row.reset_at).getTime() - Date.now()) / 1000),
  );

  return {
    ok: row.count <= limit.max,
    remaining: Math.max(0, limit.max - row.count),
    retryAfterSeconds,
  };
}

/**
 * Clear every shared counter. Tests, and nothing else.
 *
 * `resetBuckets` cannot do this: it is synchronous because the Map is, and
 * every caller is a `beforeEach` that expects it to be. So the shared half is
 * cleared from `test/helpers.ts` instead, which is where the rest of the
 * between-tests truncation lives.
 */
export async function resetSharedBuckets(): Promise<void> {
  await query('delete from rate_limits');
}

/** Drop windows that have closed. Called on the same timer as the in-memory sweep. */
export async function sweepSharedBuckets(): Promise<number> {
  const rows = await query<{ key: string }>(
    'delete from rate_limits where reset_at <= now() returning key',
  );
  return rows.length;
}

function refuse(name: string): never {
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

/** Before auth resolves a user there is nobody to limit but the address. */
const keyFor = (request: FastifyRequest, name: string): string =>
  `${name}:${request.ctx?.userId ?? request.ip}`;

function enforce(request: FastifyRequest, name: string, limit: Limit): void {
  if (!take(keyFor(request, name), limit).ok) refuse(name);
}

/**
 * The shared version, and what happens when the database is not there.
 *
 * A limiter that cannot count must decide whether to refuse everybody or to
 * let everybody through, and neither is obviously right. It lets them through:
 * nearly every route behind this one needs the same database a moment later
 * and will fail honestly on its own, so refusing here would only replace a
 * real error with a misleading one. The event is logged at warn, because a
 * limiter that is silently not limiting is exactly the thing §17 is trying
 * not to ship.
 */
async function enforceShared(request: FastifyRequest, name: string, limit: Limit): Promise<void> {
  let verdict: Verdict;

  try {
    verdict = await takeShared(keyFor(request, name), limit);
  } catch (error) {
    log.warn({ err: error, limit: name }, 'shared rate limit unavailable, allowing the request');
    return;
  }

  if (!verdict.ok) refuse(name);
}

/**
 * Sign-in, which is unauthenticated and therefore keyed by address. Tight:
 * nobody signs in twenty times an hour, and this is the one door a stranger
 * can knock on.
 */
export const AUTH_LIMIT: Limit = { max: 20, windowMs: 60 * 60_000 };

// Starting a browser pairing is the third unauthenticated door, and it mints
// a code — so it is held to the same twenty an hour.
const AUTH_PATHS = ['/auth/apple', '/auth/apple/nonce', '/admin/pair'];

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
      await enforceShared(request, 'auth', AUTH_LIMIT);
    }

    if (request.method === 'POST' && LLM_PATHS.includes(path)) {
      await enforceShared(request, 'llm', LLM_LIMIT);
    }
  });

  const timer = setInterval(() => {
    sweepBuckets();
    // Every process sweeps, and they will sometimes sweep the same rows. The
    // delete is keyed on expiry rather than on what the sweeper believes is
    // there, so the second one simply finds nothing and costs a query.
    void sweepSharedBuckets().catch((error: unknown) => {
      log.warn({ err: error }, 'could not sweep shared rate limit rows');
    });
  }, 5 * 60_000);
  timer.unref();
}
