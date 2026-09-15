/**
 * Formatting for the two numbers the programme editor added.
 *
 * Both sit on chips somebody taps between sets, so both are read at a glance
 * or not at all. The rest of `format.ts` is older than this file and is not
 * covered here.
 */
import { describe, expect, it } from 'vitest';
import { incrementKg, longDate, restTime } from '../format';

describe('a plate jump', () => {
  it('keeps the decimals it needs', () => {
    expect(incrementKg(1.25)).toBe('1.25');
  });

  it('drops the ones it does not', () => {
    // "5.00 kg" on a chip reads as a precision the number does not have.
    expect(incrementKg(5)).toBe('5');
    expect(incrementKg(1)).toBe('1');
  });

  it('keeps a single decimal single', () => {
    expect(incrementKg(2.5)).toBe('2.5');
    expect(incrementKg(0.5)).toBe('0.5');
  });
});

describe('a rest interval', () => {
  it('reads as a clock once it passes a minute', () => {
    // 150 is the server's default for a press, and "2:30" is read at a
    // glance where "150 s" has to be divided first.
    expect(restTime(150)).toBe('2:30');
    expect(restTime(60)).toBe('1:00');
    expect(restTime(240)).toBe('4:00');
  });

  it('stays in seconds below a minute', () => {
    // "0:45" reads as a stopwatch that is already running.
    expect(restTime(45)).toBe('45s');
    expect(restTime(0)).toBe('0s');
  });

  it('pads the seconds, so 1:05 is not 1:5', () => {
    expect(restTime(65)).toBe('1:05');
  });
});

describe('a long date', () => {
  it('reads a calendar day', () => {
    expect(longDate('2026-09-14')).toContain('14');
  });

  it('reads a timestamp too', () => {
    // The session's performedAt is an instant, not a day. Pinning noon to it
    // built '2026-09-14T14:32:16.848ZT12:00:00' and the report screen died on
    // 'Invalid time value' the first time somebody finished a session.
    expect(longDate('2026-09-14T14:32:16.848Z')).toContain('14');
  });
});
