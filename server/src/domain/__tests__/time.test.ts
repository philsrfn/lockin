import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayIn,
  dayRangeIn,
  daySpanIn,
  isValidTimeZone,
  minutesOfDayIn,
  startOfDayIn,
  trailingDaysIn,
} from '../time';

const BERLIN = 'Europe/Berlin';
const BOSTON = 'America/New_York';
const AUCKLAND = 'Pacific/Auckland';
const KATHMANDU = 'Asia/Kathmandu';
const at = (iso: string) => new Date(iso);

describe('dayIn', () => {
  it('reads the calendar date in the given zone', () => {
    expect(dayIn(BERLIN, at('2026-09-02T10:00:00Z'))).toBe('2026-09-02');
  });

  it('puts a late Berlin evening and the same instant in Boston on different days', () => {
    // 22:30 in Berlin on the 2nd is 16:30 in Boston on the 2nd.
    const instant = at('2026-09-02T20:30:00Z');
    expect(dayIn(BERLIN, instant)).toBe('2026-09-02');
    expect(dayIn(BOSTON, instant)).toBe('2026-09-02');
  });

  it('rolls over at the athlete\'s midnight, not the server\'s', () => {
    // 01:30 UTC: still the 2nd in Boston, already the 3rd in Berlin.
    const instant = at('2026-09-03T01:30:00Z');
    expect(dayIn(BERLIN, instant)).toBe('2026-09-03');
    expect(dayIn(BOSTON, instant)).toBe('2026-09-02');
  });

  it('handles a zone a day ahead', () => {
    expect(dayIn(AUCKLAND, at('2026-09-02T23:00:00Z'))).toBe('2026-09-03');
  });

  it('handles a zone offset by three quarters of an hour', () => {
    // Kathmandu is UTC+05:45.
    expect(dayIn(KATHMANDU, at('2026-09-02T18:20:00Z'))).toBe('2026-09-03');
    expect(dayIn(KATHMANDU, at('2026-09-02T18:10:00Z'))).toBe('2026-09-02');
  });

  it('reads midnight as the new day, not as hour 24 of the old one', () => {
    expect(dayIn(BERLIN, at('2026-09-01T22:00:00Z'))).toBe('2026-09-02');
  });
});

describe('minutesOfDayIn', () => {
  it('counts minutes since local midnight', () => {
    expect(minutesOfDayIn(BERLIN, at('2026-09-02T05:30:00Z'))).toBe(7 * 60 + 30);
  });

  it('is zero at local midnight, not 1440', () => {
    expect(minutesOfDayIn(BERLIN, at('2026-09-01T22:00:00Z'))).toBe(0);
  });

  it('gives the same instant a different clock reading in each zone', () => {
    const instant = at('2026-09-02T05:30:00Z');
    // 07:30 in Berlin is the morning check-in; the same instant is 01:30 in
    // Boston, which is the bug this whole module exists to prevent.
    expect(minutesOfDayIn(BERLIN, instant)).toBe(450);
    expect(minutesOfDayIn(BOSTON, instant)).toBe(90);
  });
});

describe('startOfDayIn', () => {
  it('finds local midnight in summer time', () => {
    expect(startOfDayIn(BERLIN, '2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('finds local midnight in winter time', () => {
    expect(startOfDayIn(BERLIN, '2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('is right on the day the clocks go forward', () => {
    // Germany springs forward at 02:00 on the last Sunday in March. Midnight
    // itself is unaffected, but the day is 23 hours long.
    const start = startOfDayIn(BERLIN, '2026-03-29');
    const end = startOfDayIn(BERLIN, '2026-03-30');

    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('is right on the day the clocks go back', () => {
    const start = startOfDayIn(BERLIN, '2026-10-25');
    const end = startOfDayIn(BERLIN, '2026-10-26');

    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('lands on the requested day in a zone that shifts across midnight', () => {
    // Lord Howe and Santiago move their clocks at midnight; local 00:00 does
    // not exist on the changeover day. The answer must still be inside the day.
    const start = startOfDayIn('America/Santiago', '2026-09-06');

    expect(dayIn('America/Santiago', start)).toBe('2026-09-06');
  });

  it('round-trips: the start of a day reads back as that day', () => {
    for (const zone of [BERLIN, BOSTON, AUCKLAND, KATHMANDU]) {
      for (const day of ['2026-01-01', '2026-03-29', '2026-06-30', '2026-10-25', '2026-12-31']) {
        expect(dayIn(zone, startOfDayIn(zone, day))).toBe(day);
      }
    }
  });

  it('rejects something that is not a date', () => {
    expect(() => startOfDayIn(BERLIN, '02.09.2026')).toThrow('Not a YYYY-MM-DD date');
  });
});

describe('addDays', () => {
  it('walks the calendar forwards and backwards', () => {
    expect(addDays('2026-09-02', 1)).toBe('2026-09-03');
    expect(addDays('2026-09-02', -6)).toBe('2026-08-27');
  });

  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('does not stumble over a day that is 23 hours long', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});

describe('dayRangeIn', () => {
  it('is half-open, so 23:59:59.9 still counts as that day', () => {
    const { from, until } = dayRangeIn(BERLIN, '2026-09-02');
    const lateDinner = at('2026-09-02T21:59:59.900Z');

    expect(lateDinner >= from).toBe(true);
    expect(lateDinner < until).toBe(true);
  });

  it('excludes the first instant of the following day', () => {
    const { until } = dayRangeIn(BERLIN, '2026-09-02');

    expect(dayIn(BERLIN, until)).toBe('2026-09-03');
  });

  it('covers exactly 24 hours on an ordinary day', () => {
    const { from, until } = dayRangeIn(BERLIN, '2026-09-02');

    expect((until.getTime() - from.getTime()) / 3_600_000).toBe(24);
  });

  it('gives the same date different bounds in different zones', () => {
    const berlin = dayRangeIn(BERLIN, '2026-09-02');
    const boston = dayRangeIn(BOSTON, '2026-09-02');

    expect(boston.from.getTime()).toBeGreaterThan(berlin.from.getTime());
  });
});

describe('daySpanIn', () => {
  it('spans from the first day to the end of the last, inclusive', () => {
    const span = daySpanIn(BERLIN, '2026-08-27', '2026-09-02');

    expect(span.from.toISOString()).toBe('2026-08-26T22:00:00.000Z');
    expect(dayIn(BERLIN, span.until)).toBe('2026-09-03');
  });
});

describe('trailingDaysIn', () => {
  it('counts the days shown, so seven is today and the six before it', () => {
    const window = trailingDaysIn(BERLIN, 7, at('2026-09-02T10:00:00Z'));

    expect(window.firstDay).toBe('2026-08-27');
    expect(window.lastDay).toBe('2026-09-02');
  });

  it('ends today in the athlete\'s zone, not the server\'s', () => {
    // 01:30 UTC on the 3rd is still the 2nd in Boston.
    const window = trailingDaysIn(BOSTON, 7, at('2026-09-03T01:30:00Z'));

    expect(window.lastDay).toBe('2026-09-02');
  });
});

describe('isValidTimeZone', () => {
  it('accepts an IANA zone', () => {
    expect(isValidTimeZone(BERLIN)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects nonsense, so a bad settings value cannot reach the database', () => {
    expect(isValidTimeZone('Europe/Atlantis')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
