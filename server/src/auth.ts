import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Ctx, ctxFor } from './db';
import { unauthorized } from './errors';
import { findUserByToken } from './services/users';

/**
 * Reachable without a token. Two of these are how a token is obtained, so they
 * cannot require one — they are rate limited hard instead. Matched exactly, so
 * that a path merely starting with one of these is not accidentally public.
 */
const PUBLIC_PATHS = new Set(['/health', '/auth/apple', '/auth/apple/nonce']);

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Who is asking. Set by the auth hook, and the only way a route reaches
     * data — there is no service call that does not take one.
     */
    ctx: Ctx;
  }
}

/**
 * One long-lived token per athlete, held in the iOS keychain. No signup flow,
 * no refresh, no password reset — §2 says do not build auth infrastructure,
 * and this is the smallest thing that supports more than one person.
 *
 * The token is matched by its sha256 against `users.token_hash`, so the check
 * is an index lookup rather than a comparison against one environment variable,
 * and a database dump is not a list of passwords. Sign in with Apple replaces
 * the front of this; the row it resolves to does not change.
 */
export function registerAuth(app: FastifyInstance): void {
  // Declared null on the prototype; the hook below assigns a real one per
  // request, before any handler runs. A request that reaches a handler without
  // it has already been rejected.
  app.decorateRequest('ctx', null as unknown as Ctx);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const path = request.url.split('?')[0] ?? request.url;
    if (PUBLIC_PATHS.has(path)) return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing bearer token');
    }

    const user = await findUserByToken(header.slice('Bearer '.length));
    if (!user) {
      // Deliberately the same message whether the token is malformed, expired
      // or simply someone else's.
      throw unauthorized('Invalid bearer token');
    }

    request.ctx = ctxFor(user.id);
  });
}
