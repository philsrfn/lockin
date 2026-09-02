/**
 * Bodyweight. The screen is one number pad and three seconds, so almost all the
 * behaviour worth testing is what happens around that: one row per day, the
 * seven-day average being the number that counts, and a slipped decimal point
 * never becoming a data point.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isoDaysAgo, resetData, resetProfile } from '../../test/helpers';
import { listEntries, logWeight, summary } from '../bodyweight';

beforeEach(async () => {
  await resetData();
  await resetProfile();
});

describe('logWeight', () => {
  it('defaults to today and returns the entry with a fresh summary', async () => {
    const result = await logWeight({ weightKg: 99.4 });

    expect(result.entry).toEqual({ measuredOn: isoDaysAgo(0), weightKg: 99.4 });
    expect(result.summary.latest?.weightKg).toBe(99.4);
  });

  it('upserts: stepping on the scale twice replaces the morning number', async () => {
    await logWeight({ measuredOn: isoDaysAgo(0), weightKg: 99.4 });
    await logWeight({ measuredOn: isoDaysAgo(0), weightKg: 99.1 });

    const entries = await listEntries(7);

    expect(entries).toEqual([{ measuredOn: isoDaysAgo(0), weightKg: 99.1 }]);
  });

  it.each([
    ['a date that is not ISO', { measuredOn: '02.09.2026' }, 'measuredOn must be YYYY-MM-DD'],
    ['a weight that is not a number', { weightKg: Number.NaN }, 'weightKg must be a number'],
    ['a slipped decimal point downward', { weightKg: 9.94 }, 'between 30 and 300'],
    ['a slipped decimal point upward', { weightKg: 994 }, 'between 30 and 300'],
  ])('rejects %s', async (_label, override, message) => {
    await expect(logWeight({ weightKg: 99.4, ...override })).rejects.toThrow(message);
  });

  it('keeps numeric precision rather than handing back a string', async () => {
    const result = await logWeight({ weightKg: 87.5 });

    expect(result.entry.weightKg).toBe(87.5);
    expect(typeof result.entry.weightKg).toBe('number');
  });
});

describe('listEntries', () => {
  it('returns oldest first, windowed by days', async () => {
    await logWeight({ measuredOn: isoDaysAgo(40), weightKg: 101 });
    await logWeight({ measuredOn: isoDaysAgo(3), weightKg: 99 });
    await logWeight({ measuredOn: isoDaysAgo(1), weightKg: 98.6 });

    const entries = await listEntries(7);

    expect(entries.map((entry) => entry.weightKg)).toEqual([99, 98.6]);
  });
});

describe('summary', () => {
  it('is empty rather than zeroed when he has never weighed in', async () => {
    const result = await summary();

    expect(result.latest).toBeNull();
    expect(result.average7).toBeNull();
    expect(result.changeKg).toBeNull();
    // The series still has a point per day — the sparkline needs an x-axis
    // even before there is a line. Every value is null, not zero.
    expect(result.series).toHaveLength(30);
    expect(result.series.every((point) => point.weightKg === null && point.avgKg === null)).toBe(
      true,
    );
  });

  it('carries the goal weight through from the profile', async () => {
    expect((await summary()).goalWeightKg).toBe(80);
  });

  it('averages the last seven calendar days, not the last seven entries', async () => {
    // A gap-riddled fortnight: an average over "the last seven rows" would
    // reach back three weeks and report a heavier man than he is.
    await logWeight({ measuredOn: isoDaysAgo(20), weightKg: 110 });
    await logWeight({ measuredOn: isoDaysAgo(19), weightKg: 110 });
    await logWeight({ measuredOn: isoDaysAgo(2), weightKg: 100 });
    await logWeight({ measuredOn: isoDaysAgo(0), weightKg: 99 });

    const result = await summary();

    expect(result.average7?.avgKg).toBeCloseTo(99.5, 5);
    expect(result.average7?.sampleCount).toBe(2);
  });

  it('reports week-over-week change as a loss when he is losing', async () => {
    for (let day = 13; day >= 0; day -= 1) {
      await logWeight({ measuredOn: isoDaysAgo(day), weightKg: 100 - (13 - day) * 0.1 });
    }

    const result = await summary();

    expect(result.changeKg).toBeLessThan(0);
    expect(result.changeKg).toBeCloseTo(-0.7, 1);
  });

  it('reaches further back than the requested window so early points have a full average', async () => {
    await logWeight({ measuredOn: isoDaysAgo(35), weightKg: 102 });
    await logWeight({ measuredOn: isoDaysAgo(30), weightKg: 101 });
    await logWeight({ measuredOn: isoDaysAgo(0), weightKg: 99 });

    // 30 days of series, but the query fetches 44 so the oldest point is not
    // an average of one.
    const result = await summary(30);

    expect(result.series.length).toBeGreaterThan(0);
    expect(result.series.at(-1)?.date).toBe(isoDaysAgo(0));
  });
});
