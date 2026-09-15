import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_LIVE_HOURS, isAbandoned } from '../sessionAge';

const now = new Date('2026-09-15T18:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe('isAbandoned', () => {
  it('keeps a session that is still inside the live window', () => {
    expect(isAbandoned(hoursAgo(1), now)).toBe(false);
    expect(isAbandoned(hoursAgo(5.99), now)).toBe(false);
  });

  // The server's rule is `hours < 6` for live, so six exactly is no longer live.
  it('lets go of it at six hours, the same boundary the server uses', () => {
    expect(isAbandoned(hoursAgo(6), now)).toBe(true);
  });

  it('lets go of the one started days ago and never closed', () => {
    expect(isAbandoned(hoursAgo(72), now)).toBe(true);
  });

  it('keeps a session whose clock is ahead of this phone', () => {
    expect(isAbandoned(new Date(now.getTime() + 60_000).toISOString(), now)).toBe(false);
  });

  it('keeps a session whose date cannot be read, rather than closing it on a parse error', () => {
    expect(isAbandoned('not a date', now)).toBe(false);
  });
});

/**
 * The phone keeps its own copy of the number because it has to decide with no
 * signal. A copy is only safe while something notices when it stops being one.
 */
describe('SESSION_LIVE_HOURS', () => {
  it('is the same number the server counts by', () => {
    const server = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'server', 'src', 'domain', 'session.ts'),
      'utf8',
    );
    const match = server.match(/export const SESSION_LIVE_HOURS = (\d+)/);
    expect(match, 'server/src/domain/session.ts no longer exports SESSION_LIVE_HOURS').not.toBeNull();
    expect(Number(match![1])).toBe(SESSION_LIVE_HOURS);
  });
});
