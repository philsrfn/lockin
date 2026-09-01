import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from './env';
import { unauthorized } from './errors';

/** Paths reachable without the bearer token. */
const PUBLIC_PATHS = new Set(['/health']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Hashed first so both sides are always 32 bytes — timingSafeEqual throws on a
// length mismatch, and the throw itself would leak the token length.
const expected = digest(env.bearerToken);

/**
 * One user, one long-lived token in the iOS keychain. No user table, no signup,
 * no refresh — per §2 of the spec, do not build auth infrastructure.
 */
export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (PUBLIC_PATHS.has(path)) return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }

    if (!timingSafeEqual(digest(header.slice('Bearer '.length)), expected)) {
      throw unauthorized('Invalid bearer token');
    }
  });
}
