import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Ctx, ctxFor } from './db';
import { HttpError, unauthorized } from './errors';
import { type User, findUserByToken } from './services/users';

/**
 * Reachable without a token. Two of these are how a token is obtained, so they
 * cannot require one — they are rate limited hard instead. Matched exactly, so
 * that a path merely starting with one of these is not accidentally public.
 */
const PUBLIC_PATHS = new Set([
  '/health',
  '/auth/apple',
  '/auth/apple/nonce',
  // The admin page itself is a shell: a token box and the script that fills
  // it in. A browser cannot send an Authorization header for its own document
  // request, so the HTML is public and every byte of data behind it is not.
  '/admin',
]);

/** What an account that has not been approved yet may still do. */
const PENDING_MAY = new Set(['/auth/signout', '/account']);

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Who is asking. Set by the auth hook, and the only way a route reaches
     * data — there is no service call that does not take one.
     */
    ctx: Ctx;
    /** The row the token resolved to. Only the admin routes read this. */
    user: User;
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
  app.decorateRequest('user', null as unknown as User);

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

    /**
     * Signing in with Apple creates the account; it does not admit it. An
     * account waiting on the admin panel holds a working token and can reach
     * nothing with it — 403 rather than 401, because retrying with a different
     * token is not the answer and the app should say so plainly.
     *
     * Except leaving. Somebody who is not being let in must still be able to
     * sign out of the phone and to erase the account they created, without
     * needing the permission they are waiting on.
     */
    if (!user.approvedAt && !PENDING_MAY.has(path)) {
      throw new HttpError(
        403,
        'This account is waiting to be let in. You will not need to do anything ' +
          'when it is — just open the app again.',
        'pending_approval',
      );
    }

    request.ctx = ctxFor(user.id);
    request.user = user;
  });

}

/**
 * The admin panel, and nothing else, sits behind this.
 *
 * Deliberately not "holds a token on users.token_hash": the CLI hands those to
 * friends, and a friend is not an operator. The flag is set in the database and
 * by no route, so the panel cannot grant access to itself.
 */
export function requireAdmin(request: { user?: User }): User {
  const user = request.user;
  if (!user?.isAdmin) {
    // The same answer a signed-in athlete gets for a path that does not exist.
    // There is no reason to confirm the panel is here.
    throw new HttpError(404, 'Not found');
  }
  return user;
}
