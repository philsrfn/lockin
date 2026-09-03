/**
 * Single-use nonces for Apple sign-in.
 *
 * The server issues the nonce rather than trusting one the client made up.
 * That is what makes a captured identity token useless twice: the value Apple
 * echoes back has to be one we handed out a moment ago and have not yet seen
 * used.
 *
 * In memory, on purpose. One box, one process, and a nonce is worthless a few
 * minutes after it is issued — the worst a restart can do is make somebody
 * mid-sign-in tap the button again. When there is a second process, this is
 * the file that has to change.
 */
import { randomBytes } from 'node:crypto';

/** Long enough to finish the Apple sheet, short enough to be worthless later. */
const TTL_MS = 10 * 60_000;

/** A cap, so a flood of requests cannot grow this without limit. */
const MAX_OUTSTANDING = 10_000;

const outstanding = new Map<string, number>();

function sweep(now: number): void {
  for (const [value, expiresAt] of outstanding) {
    if (expiresAt <= now) outstanding.delete(value);
  }
}

export function issueNonce(now = Date.now()): string {
  sweep(now);
  if (outstanding.size >= MAX_OUTSTANDING) {
    // Drop the oldest rather than refusing: a legitimate sign-in should not
    // fail because somebody else is hammering the endpoint.
    const oldest = [...outstanding.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) outstanding.delete(oldest[0]);
  }

  const value = randomBytes(32).toString('base64url');
  outstanding.set(value, now + TTL_MS);
  return value;
}

/** True once, then never again for that value. */
export function consumeNonce(value: string, now = Date.now()): boolean {
  const expiresAt = outstanding.get(value);
  if (expiresAt === undefined) return false;

  outstanding.delete(value);
  return expiresAt > now;
}

/** Between tests. */
export function forgetNonces(): void {
  outstanding.clear();
}

export function outstandingNonces(): number {
  return outstanding.size;
}
