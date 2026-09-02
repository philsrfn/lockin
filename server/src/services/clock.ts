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
import type { Ctx } from '../db';
import { DEFAULT_TIME_ZONE, type DayRange, dayIn, dayRangeIn, trailingDaysIn } from '../domain/time';

export async function athleteZone(ctx: Ctx): Promise<string> {
  const { rows } = await ctx.db.query<{ timezone: string }>(
    'select timezone from profile where user_id = $1',
    [ctx.userId],
  );
  return rows[0]?.timezone ?? DEFAULT_TIME_ZONE;
}

/** Today's date in his zone, 'YYYY-MM-DD'. */
export async function athleteToday(ctx: Ctx, now: Date = new Date()): Promise<string> {
  return dayIn(await athleteZone(ctx), now);
}

/** Half-open bounds for one of his days, for `where t >= from and t < until`. */
export async function athleteDayRange(ctx: Ctx, day: string): Promise<DayRange> {
  return dayRangeIn(await athleteZone(ctx), day);
}

/** The last `days` of his days, ending today. */
export async function athleteTrailingDays(
  ctx: Ctx,
  days: number,
  now: Date = new Date(),
): Promise<DayRange & { firstDay: string; lastDay: string }> {
  return trailingDaysIn(await athleteZone(ctx), days, now);
}
