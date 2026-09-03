/**
 * Letting a browser into the admin panel, without typing a token into it.
 *
 * Apple has no native sign-in on the web that this deployment can use — it
 * wants a Services ID and a verified domain, and the deployment is an IP
 * address wearing an sslip.io hostname. So the browser does not authenticate
 * at all: the phone does, with Apple, as it already does, and then vouches for
 * the browser.
 *
 *   browser  POST /admin/pair        -> { id, code }
 *   browser  shows the code, polls GET /admin/pair/:id
 *   phone    POST /admin/pair/claim  { code }   (signed in, and an admin)
 *   browser  next poll returns a session token
 *
 * The two halves are deliberately different sizes. `code` is six characters
 * because a person types it; it is useless on its own, since claiming it
 * requires an admin's token. `id` is 32 random bytes because holding it is
 * what collects the session — it never leaves the browser that made it.
 *
 * Pairings live in memory. A restart drops the ones in flight, which costs
 * somebody five seconds and a second attempt; persisting them would mean a
 * table whose rows are all garbage within five minutes.
 */
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Five minutes: long enough to find your phone, short enough not to linger. */
const TTL_MS = 5 * 60_000;

/** A ceiling, so an unauthenticated endpoint cannot grow the heap. */
const MAX_OUTSTANDING = 500;

/**
 * No 0/O, no 1/I. The code is read off one screen and typed into another, and
 * the two characters people get wrong are the two that look like each other.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Pairing = {
  code: string;
  expiresAt: number;
  /** Set when a phone claims it. Until then the browser gets nothing. */
  claimedBy: number | null;
};

const pairings = new Map<string, Pairing>();

function sweep(now = Date.now()): void {
  for (const [id, pairing] of pairings) {
    if (pairing.expiresAt <= now) pairings.delete(id);
  }
}

export type StartedPairing = { id: string; code: string; expiresInSeconds: number };

export function startPairing(): StartedPairing {
  sweep();
  if (pairings.size >= MAX_OUTSTANDING) {
    // Drop the oldest rather than refusing: the alternative is that filling
    // the map locks the operator out of their own panel.
    const oldest = pairings.keys().next().value;
    if (oldest) pairings.delete(oldest);
  }

  const id = randomBytes(32).toString('base64url');
  const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

  pairings.set(id, { code, expiresAt: Date.now() + TTL_MS, claimedBy: null });

  return { id, code, expiresInSeconds: Math.floor(TTL_MS / 1000) };
}

/**
 * The phone vouching for the browser. Returns false for a code that is wrong,
 * expired, or already used — the caller says the same thing for all three,
 * because distinguishing them only helps somebody guessing.
 */
export function claimPairing(code: string, userId: number): boolean {
  sweep();
  const wanted = code.trim().toUpperCase();

  for (const pairing of pairings.values()) {
    if (pairing.claimedBy !== null) continue;
    if (!sameCode(pairing.code, wanted)) continue;

    pairing.claimedBy = userId;
    return true;
  }

  return false;
}

/**
 * The browser collecting what it is owed. Single use: the pairing is gone
 * whether or not anybody claimed it, so a leaked id is worth one attempt.
 */
export function collectPairing(id: string): { claimedBy: number } | 'pending' | null {
  sweep();
  const pairing = pairings.get(id);
  if (!pairing) return null;
  if (pairing.claimedBy === null) return 'pending';

  pairings.delete(id);
  return { claimedBy: pairing.claimedBy };
}

/** Constant-time, so the response cannot be timed into a code. */
function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Tests only. */
export function forgetPairings(): void {
  pairings.clear();
}

export function outstandingPairings(): number {
  sweep();
  return pairings.size;
}
