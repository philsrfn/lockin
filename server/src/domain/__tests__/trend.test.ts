import { describe, expect, it } from 'vitest';
import { type WeightEntry, addDays, movingAverage, trendSeries, weeklyChangeKg } from '../trend';

/** A run of daily weigh-ins ending on `lastDay`, newest value last. */
function daily(lastDay: string, weights: number[]): WeightEntry[] {
  return weights.map((weightKg, i) => ({
    measuredOn: addDays(lastDay, i - (weights.length - 1)),
    weightKg,
  }));
}

describe('addDays', () => {
  it('walks calendar days without tripping over month ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-01', 0)).toBe('2026-09-01');
  });

  it('is not shifted by the local timezone', () => {
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });
});

describe('movingAverage', () => {
  it('is null when he has never weighed in', () => {
    expect(movingAverage([], '2026-09-01')).toBeNull();
  });

  it('averages the window and reports how many days actually fed it', () => {
    const entries = daily('2026-09-01', [99.6, 99.9, 99.2, 99.4, 98.8, 99.1, 98.7]);
    const avg = movingAverage(entries, '2026-09-01');
    expect(avg?.sampleCount).toBe(7);
    expect(avg?.avgKg).toBeCloseTo(99.24, 2);
  });

  it('works off one weigh-in and says so, rather than pretending to a trend', () => {
    const avg = movingAverage([{ measuredOn: '2026-09-01', weightKg: 100 }], '2026-09-01');
    expect(avg).toEqual({ avgKg: 100, sampleCount: 1, windowDays: 7 });
  });

  it('counts calendar days, not entries — missed weigh-ins must not stretch the window', () => {
    const entries: WeightEntry[] = [
      { measuredOn: '2026-08-01', weightKg: 105 }, // long before the window
      { measuredOn: '2026-08-30', weightKg: 99 },
      { measuredOn: '2026-09-01', weightKg: 98 },
    ];
    const avg = movingAverage(entries, '2026-09-01');
    expect(avg?.sampleCount).toBe(2);
    expect(avg?.avgKg).toBeCloseTo(98.5, 2);
  });

  it('includes the boundary day and excludes the one before it', () => {
    const entries: WeightEntry[] = [
      { measuredOn: '2026-08-25', weightKg: 90 }, // asOf - 7, out
      { measuredOn: '2026-08-26', weightKg: 100 }, // asOf - 6, in
    ];
    const avg = movingAverage(entries, '2026-09-01');
    expect(avg?.sampleCount).toBe(1);
    expect(avg?.avgKg).toBe(100);
  });

  it('ignores entries in the future', () => {
    const entries: WeightEntry[] = [
      { measuredOn: '2026-09-01', weightKg: 98 },
      { measuredOn: '2026-09-02', weightKg: 80 },
    ];
    expect(movingAverage(entries, '2026-09-01')?.avgKg).toBe(98);
  });

  it('does not care what order the rows arrive in', () => {
    const shuffled: WeightEntry[] = [
      { measuredOn: '2026-08-30', weightKg: 99 },
      { measuredOn: '2026-09-01', weightKg: 98 },
      { measuredOn: '2026-08-31', weightKg: 100 },
    ];
    expect(movingAverage(shuffled, '2026-09-01')?.avgKg).toBeCloseTo(99, 5);
  });

  it('honours a custom window', () => {
    const entries = daily('2026-09-01', [100, 99, 98]);
    expect(movingAverage(entries, '2026-09-01', 2)?.sampleCount).toBe(2);
  });
});

describe('weeklyChangeKg', () => {
  it('is null until there are two full windows to compare', () => {
    const entries = daily('2026-09-01', [100, 99.8, 99.6]);
    expect(weeklyChangeKg(entries, '2026-09-01')).toBeNull();
  });

  it('reports a loss as a negative number', () => {
    const entries = daily('2026-09-14', [
      100, 100, 100, 100, 100, 100, 100, // 2026-09-01 .. 09-07
      99, 99, 99, 99, 99, 99, 99, //        2026-09-08 .. 09-14
    ]);
    expect(weeklyChangeKg(entries, '2026-09-14')).toBeCloseTo(-1, 5);
  });

  it('reports a gain as a positive number', () => {
    const entries = daily('2026-09-14', [
      98, 98, 98, 98, 98, 98, 98,
      98.5, 98.5, 98.5, 98.5, 98.5, 98.5, 98.5,
    ]);
    expect(weeklyChangeKg(entries, '2026-09-14')).toBeCloseTo(0.5, 5);
  });

  it('compares averages, so one dehydrated morning does not become a trend', () => {
    const entries = daily('2026-09-14', [
      99, 99, 99, 99, 99, 99, 99,
      99, 99, 99, 99, 99, 99, 96, // one wild reading on the last day
    ]);
    const change = weeklyChangeKg(entries, '2026-09-14');
    expect(change).toBeCloseTo(-3 / 7, 5);
  });
});

describe('trendSeries', () => {
  it('returns one point per day, oldest first, ending on asOf', () => {
    const entries = daily('2026-09-01', [100, 99.5, 99]);
    const series = trendSeries(entries, '2026-09-01', 3);
    expect(series).toHaveLength(3);
    expect(series[0]?.date).toBe('2026-08-30');
    expect(series[2]?.date).toBe('2026-09-01');
  });

  it('carries the raw reading alongside the average, and null on days he skipped', () => {
    const entries: WeightEntry[] = [
      { measuredOn: '2026-08-30', weightKg: 100 },
      { measuredOn: '2026-09-01', weightKg: 99 },
    ];
    const series = trendSeries(entries, '2026-09-01', 3);
    expect(series[0]).toEqual({ date: '2026-08-30', weightKg: 100, avgKg: 100 });
    expect(series[1]?.weightKg).toBeNull();
    expect(series[1]?.avgKg).toBe(100); // average holds across a skipped day
    expect(series[2]?.weightKg).toBe(99);
    expect(series[2]?.avgKg).toBeCloseTo(99.5, 5);
  });

  it('leaves the average null before the first ever weigh-in', () => {
    const series = trendSeries([{ measuredOn: '2026-09-01', weightKg: 99 }], '2026-09-01', 3);
    expect(series[0]?.avgKg).toBeNull();
    expect(series[1]?.avgKg).toBeNull();
    expect(series[2]?.avgKg).toBe(99);
  });

  it('is empty rather than throwing when asked for nothing', () => {
    expect(trendSeries([], '2026-09-01', 0)).toEqual([]);
  });
});
