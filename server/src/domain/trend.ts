/**
 * Bodyweight trend. Pure.
 *
 * The daily number is noise — water, salt, sleep. The 7-day average is the
 * number that counts (§11), so it is what the app shows and what the weekly
 * review will read.
 *
 * Dates are plain 'YYYY-MM-DD' strings throughout. They sort lexicographically,
 * they survive a round trip through JSON, and they cannot be shifted an hour
 * backwards into yesterday by a timezone.
 */

// Calendar arithmetic lives in ./time, which is also where "today" is decided.
// Re-exported below so the trend's callers do not need to know that.
import { addDays } from './time';

export type WeightEntry = {
  measuredOn: string;
  weightKg: number;
};

export const DEFAULT_WINDOW_DAYS = 7;

export { addDays };

/**
 * The window is a span of calendar days, not a count of entries. A missed
 * weigh-in must leave a thinner average, never reach further back in time.
 */
function windowMean(
  entries: WeightEntry[],
  asOf: string,
  windowDays: number,
): { mean: number; count: number } | null {
  const from = addDays(asOf, -(windowDays - 1));

  let total = 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.measuredOn >= from && entry.measuredOn <= asOf) {
      total += entry.weightKg;
      count += 1;
    }
  }

  return count === 0 ? null : { mean: total / count, count };
}

export type MovingAverage = {
  avgKg: number;
  /** How many of the window's days actually had a weigh-in. */
  sampleCount: number;
  windowDays: number;
};

export function movingAverage(
  entries: WeightEntry[],
  asOf: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): MovingAverage | null {
  const window = windowMean(entries, asOf, windowDays);
  if (!window) return null;
  return { avgKg: window.mean, sampleCount: window.count, windowDays };
}

/**
 * Change between this window's average and the one immediately before it.
 * Negative is loss. Returns full precision — the caller decides how to round
 * it for display.
 */
export function weeklyChangeKg(
  entries: WeightEntry[],
  asOf: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): number | null {
  const current = windowMean(entries, asOf, windowDays);
  const prior = windowMean(entries, addDays(asOf, -windowDays), windowDays);
  if (!current || !prior) return null;
  return current.mean - prior.mean;
}

export type TrendPoint = {
  date: string;
  /** The raw weigh-in, or null on a day he skipped. */
  weightKg: number | null;
  avgKg: number | null;
};

/** `days` points ending on `asOf`, oldest first. Feeds the sparkline. */
export function trendSeries(
  entries: WeightEntry[],
  asOf: string,
  days: number,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): TrendPoint[] {
  const byDate = new Map(entries.map((entry) => [entry.measuredOn, entry.weightKg]));
  const points: TrendPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(asOf, -offset);
    const window = windowMean(entries, date, windowDays);
    points.push({
      date,
      weightKg: byDate.get(date) ?? null,
      avgKg: window ? window.mean : null,
    });
  }

  return points;
}
