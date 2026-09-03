import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimPairing,
  collectPairing,
  forgetPairings,
  outstandingPairings,
  startPairing,
} from '../pairing';

beforeEach(() => {
  forgetPairings();
  vi.useRealTimers();
});

describe('pairing a browser', () => {
  it('hands the browser an id and the person a code', () => {
    const { id, code } = startPairing();

    expect(id).toHaveLength(43); // 32 bytes, base64url
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('gives nothing away until a phone claims it', () => {
    const { id } = startPairing();

    expect(collectPairing(id)).toBe('pending');
  });

  it('hands over the claimer once claimed', () => {
    const { id, code } = startPairing();

    expect(claimPairing(code, 1)).toBe(true);
    expect(collectPairing(id)).toEqual({ claimedBy: 1 });
  });

  it('is collected exactly once, so a leaked id is worth one attempt', () => {
    const { id, code } = startPairing();
    claimPairing(code, 1);

    expect(collectPairing(id)).toEqual({ claimedBy: 1 });
    expect(collectPairing(id)).toBe(null);
  });

  it('is claimed exactly once', () => {
    const { code } = startPairing();

    expect(claimPairing(code, 1)).toBe(true);
    expect(claimPairing(code, 2)).toBe(false);
  });

  it('accepts the code as it was read off a screen', () => {
    // Typed on a phone, which will lowercase it and may leave a space.
    const { id, code } = startPairing();

    expect(claimPairing(` ${code.toLowerCase()} `, 1)).toBe(true);
    expect(collectPairing(id)).toEqual({ claimedBy: 1 });
  });

  it('refuses a code nobody issued', () => {
    startPairing();

    expect(claimPairing('AAAAAA', 1)).toBe(false);
  });

  it('does not confuse one browser for another', () => {
    const first = startPairing();
    const second = startPairing();

    claimPairing(second.code, 7);

    expect(collectPairing(first.id)).toBe('pending');
    expect(collectPairing(second.id)).toEqual({ claimedBy: 7 });
  });

  it('avoids the characters people misread', () => {
    // O/0 and I/1 read off one screen and typed into another are the whole
    // reason a pairing code fails.
    const codes = Array.from({ length: 200 }, () => startPairing().code).join('');

    expect(codes).not.toMatch(/[O01I]/);
  });
});

describe('expiry', () => {
  it('forgets a pairing nobody used', () => {
    vi.useFakeTimers();
    const { id, code } = startPairing();

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(collectPairing(id)).toBe(null);
    expect(claimPairing(code, 1)).toBe(false);
  });

  it('still works a minute in', () => {
    vi.useFakeTimers();
    const { id, code } = startPairing();

    vi.advanceTimersByTime(60_000);

    expect(claimPairing(code, 1)).toBe(true);
    expect(collectPairing(id)).toEqual({ claimedBy: 1 });
  });

  it('does not grow without bound from an unauthenticated endpoint', () => {
    for (let i = 0; i < 600; i += 1) startPairing();

    expect(outstandingPairings()).toBeLessThanOrEqual(500);
  });

  it('keeps the newest when it sheds, so the person waiting is not the one dropped', () => {
    for (let i = 0; i < 600; i += 1) startPairing();
    const mine = startPairing();

    expect(claimPairing(mine.code, 1)).toBe(true);
  });
});
