import { describe, expect, it } from 'vitest';
import { accessFor, trialExpiry } from '../entitlement';

const now = new Date('2026-09-14T12:00:00Z');
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('what an entitlement allows', () => {
  it('lets a live trial use the trainer', () => {
    const access = accessFor({ kind: 'trial', expiresAt: inDays(5) }, now);

    expect(access.coach).toBe(true);
    expect(access.daysLeft).toBe(5);
  });

  it('stops the trainer when it has run out', () => {
    expect(accessFor({ kind: 'trial', expiresAt: inDays(-1) }, now).coach).toBe(false);
  });

  it('never stops somebody reaching their own data', () => {
    // Holding a training history hostage to force a renewal is a good way to
    // be renewed once and never trusted again.
    for (const entitlement of [
      null,
      { kind: 'trial' as const, expiresAt: inDays(-30) },
      { kind: 'paid' as const, expiresAt: inDays(-1) },
    ]) {
      expect(accessFor(entitlement, now).ownData).toBe(true);
    }
  });

  it('treats a missing entitlement as no trainer, not as a free one', () => {
    // Fail closed. A missing row means something went wrong, and the honest
    // response is not to hand out the expensive part.
    expect(accessFor(null, now)).toMatchObject({ coach: false, kind: 'none' });
  });

  it('lets a comped account run forever', () => {
    const access = accessFor({ kind: 'comped', expiresAt: null }, now);

    expect(access.coach).toBe(true);
    expect(access.daysLeft).toBeNull();
  });

  it('rounds the last day up, because four hours left is still today', () => {
    expect(accessFor({ kind: 'paid', expiresAt: new Date(now.getTime() + 4 * 3600_000) }, now))
      .toMatchObject({ coach: true, daysLeft: 1 });
  });

  it('reports zero days rather than a negative number once lapsed', () => {
    expect(accessFor({ kind: 'paid', expiresAt: inDays(-9) }, now).daysLeft).toBe(0);
  });

  it('expires exactly on the boundary rather than a moment after', () => {
    expect(accessFor({ kind: 'trial', expiresAt: now }, now).coach).toBe(false);
  });
});

describe('granting a trial', () => {
  it('runs from now for the days given', () => {
    expect(trialExpiry(14, now).toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('never grants time backwards', () => {
    expect(trialExpiry(-5, now).getTime()).toBe(now.getTime());
  });
});
