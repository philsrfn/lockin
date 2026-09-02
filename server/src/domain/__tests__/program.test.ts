import { describe, expect, it } from 'vitest';
import { DEFAULT_REP_RANGE, WEEKLY_TARGETS, defaultsForPattern, nextInRotation } from '../program';

const FULL_BODY = ['A', 'B', 'C'] as const;
const UPPER_LOWER = ['U1', 'L1', 'U2', 'L2'] as const;

describe('nextInRotation', () => {
  it('starts at the first day when he has never trained', () => {
    expect(nextInRotation(FULL_BODY, null)).toBe('A');
    expect(nextInRotation(UPPER_LOWER, null)).toBe('U1');
  });

  it('advances one place', () => {
    expect(nextInRotation(FULL_BODY, 'A')).toBe('B');
    expect(nextInRotation(UPPER_LOWER, 'L1')).toBe('U2');
  });

  it('wraps round', () => {
    expect(nextInRotation(FULL_BODY, 'C')).toBe('A');
    expect(nextInRotation(UPPER_LOWER, 'L2')).toBe('U1');
  });

  it('starts fresh when the last day belongs to another programme', () => {
    // He switched from full body to upper/lower mid-week. Guessing which
    // upper/lower day "follows C" would be inventing a continuity that is not
    // there.
    expect(nextInRotation(UPPER_LOWER, 'C')).toBe('U1');
  });

  it('has nothing to say about an empty programme', () => {
    expect(nextInRotation([], 'A')).toBeNull();
    expect(nextInRotation([], null)).toBeNull();
  });

  it('works for a programme of one day', () => {
    expect(nextInRotation(['Full'], 'Full')).toBe('Full');
  });
});

describe('defaultsForPattern', () => {
  it('rests a compound longer than an isolation', () => {
    expect(defaultsForPattern('squat').restSeconds).toBeGreaterThan(
      defaultsForPattern('iso').restSeconds,
    );
  });

  it('moves an isolation in half jumps', () => {
    expect(defaultsForPattern('iso').incrementKg).toBe(1.25);
    expect(defaultsForPattern('squat').incrementKg).toBe(2.5);
  });

  it('treats an unknown pattern as an isolation, which is the safer guess', () => {
    expect(defaultsForPattern('cardio')).toEqual(defaultsForPattern('iso'));
  });

  it('uses the default rep range throughout', () => {
    expect(defaultsForPattern('hinge').range).toEqual(DEFAULT_REP_RANGE);
  });
});

describe('WEEKLY_TARGETS', () => {
  it('is the §4 week: three strength, two zone-2', () => {
    expect(WEEKLY_TARGETS.strengthSessions).toBe(3);
    expect(WEEKLY_TARGETS.zone2Sessions).toBe(2);
  });
});
