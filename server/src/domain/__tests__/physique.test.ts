import { describe, expect, it } from 'vitest';
import { MIN_DAYS_BETWEEN, checkinDue, daysSinceCheckin } from '../physique';

describe('checkinDue', () => {
  it('is due when there has never been one', () => {
    expect(checkinDue(null, '2026-09-15')).toBe(true);
  });

  it('is not due the day after', () => {
    expect(checkinDue('2026-09-14', '2026-09-15')).toBe(false);
  });

  it('is due a day early, so a Monday photo still counts as this week', () => {
    // Sunday to Saturday is six days. The push comes on Sunday; somebody who
    // took last week's on Monday must not be turned away on the morning they
    // were asked.
    expect(MIN_DAYS_BETWEEN).toBe(6);
    expect(checkinDue('2026-09-07', '2026-09-13')).toBe(true);
    expect(checkinDue('2026-09-07', '2026-09-12')).toBe(false);
  });

  it('crosses a month boundary', () => {
    expect(checkinDue('2026-08-31', '2026-09-06')).toBe(true);
    expect(checkinDue('2026-08-31', '2026-09-05')).toBe(false);
  });

  it('is due after a long absence', () => {
    expect(checkinDue('2026-01-01', '2026-09-15')).toBe(true);
  });
});

describe('daysSinceCheckin', () => {
  it('has no answer before the first one', () => {
    expect(daysSinceCheckin(null, '2026-09-15')).toBeNull();
  });

  it('counts calendar days, not hours', () => {
    expect(daysSinceCheckin('2026-09-08', '2026-09-15')).toBe(7);
    expect(daysSinceCheckin('2026-09-15', '2026-09-15')).toBe(0);
  });
});
