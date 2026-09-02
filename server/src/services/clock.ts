/**
 * Which day it is, for this athlete.
 *
 * Every "today" in the application resolves through here, so there is exactly
 * one answer to the question and one place to change when the answer stops
 * being "wherever the server happens to be running".
 *
 * The zone lives on the profile row. After Phase 1 that row is per user and
 * this function takes a user id; nothing above it has to change.
 */
import { type Queryable, pool } from '../db';
import { DEFAULT_TIME_ZONE, type DayRange, dayIn, dayRangeIn, trailingDaysIn } from '../domain/time';

export async function athleteZone(db: Queryable = pool): Promise<string> {
  const { rows } = await db.query<{ timezone: string }>(
    'select timezone from profile where id = 1',
  );
  return rows[0]?.timezone ?? DEFAULT_TIME_ZONE;
}

/** Today's date in his zone, 'YYYY-MM-DD'. */
export async function athleteToday(db: Queryable = pool, now: Date = new Date()): Promise<string> {
  return dayIn(await athleteZone(db), now);
}

/** Half-open bounds for one of his days, for `where t >= from and t < until`. */
export async function athleteDayRange(
  day: string,
  db: Queryable = pool,
): Promise<DayRange> {
  return dayRangeIn(await athleteZone(db), day);
}

/** The last `days` of his days, ending today. */
export async function athleteTrailingDays(
  days: number,
  db: Queryable = pool,
  now: Date = new Date(),
): Promise<DayRange & { firstDay: string; lastDay: string }> {
  return trailingDaysIn(await athleteZone(db), days, now);
}
