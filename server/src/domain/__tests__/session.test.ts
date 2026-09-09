import { describe, expect, it } from 'vitest';
import { SESSION_LIVE_HOURS, didHappen, sessionState } from '../session';

const now = new Date('2026-09-09T20:00:00Z');
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);

describe('when a session stops being in progress', () => {
  it('is live while somebody could still be in the gym', () => {
    expect(sessionState({ performedAt: hoursAgo(1), rpe: null, setCount: 4 }, now)).toBe('live');
    expect(sessionState({ performedAt: hoursAgo(1), rpe: null, setCount: 0 }, now)).toBe('live');
  });

  it('is finished the moment an RPE is given, however old', () => {
    // Including a session entered after the fact with a date in the past.
    expect(sessionState({ performedAt: hoursAgo(500), rpe: 8, setCount: 12 }, now)).toBe('finished');
  });

  it('counts a stale session with sets in it as one that happened', () => {
    // The work is the evidence. This is the case that was losing sessions:
    // walking out of the gym without pressing finish is not unusual, and it
    // was hiding the whole session from progression and the weekly targets.
    expect(sessionState({ performedAt: hoursAgo(20), rpe: null, setCount: 9 }, now)).toBe(
      'finished',
    );
  });

  it('counts a stale session with nothing in it as a false start', () => {
    expect(sessionState({ performedAt: hoursAgo(20), rpe: null, setCount: 0 }, now)).toBe(
      'false_start',
    );
  });

  it('turns over exactly at the window, not before', () => {
    const justInside = hoursAgo(SESSION_LIVE_HOURS - 0.01);
    const justOutside = hoursAgo(SESSION_LIVE_HOURS + 0.01);

    expect(sessionState({ performedAt: justInside, rpe: null, setCount: 0 }, now)).toBe('live');
    expect(sessionState({ performedAt: justOutside, rpe: null, setCount: 0 }, now)).toBe(
      'false_start',
    );
  });

  it('treats a session dated in the future as live rather than as expired', () => {
    // A phone whose clock runs ahead should not file today's session under
    // "never happened".
    const ahead = new Date(now.getTime() + 3_600_000);

    expect(sessionState({ performedAt: ahead, rpe: null, setCount: 0 }, now)).toBe('live');
  });

  it('only counts finished ones as having happened', () => {
    expect(didHappen('finished')).toBe(true);
    expect(didHappen('live')).toBe(false);
    expect(didHappen('false_start')).toBe(false);
  });
});
