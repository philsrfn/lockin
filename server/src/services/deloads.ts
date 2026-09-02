/**
 * Scheduled light weeks.
 *
 * The counter is weeks in which he actually trained, not weeks on the calendar:
 * a fortnight of travel is a deload whether or not the app calls it one, and
 * following it with another would be nonsense.
 */
import type { Ctx } from '../db';
import { type DeloadStatus, deloadStatus } from '../domain/deload';
import { addDays, dayIn, daySpanIn, weekdayOf } from '../domain/time';
import { athleteZone } from './clock';

/** The Monday of the week a date falls in. Weeks are Monday-based here. */
export function weekStarting(day: string): string {
  const weekday = weekdayOf(day);
  // weekdayOf is 0 = Sunday.
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * Where he is in the block. Read-only — `ensureDeload` is what writes.
 */
export async function currentDeload(ctx: Ctx, zone?: string): Promise<DeloadStatus> {
  const timezone = zone ?? (await athleteZone(ctx));
  const thisWeek = weekStarting(dayIn(timezone));

  const { rows: profileRows } = await ctx.db.query<{ deload_every_weeks: number }>(
    'select deload_every_weeks from profile where user_id = $1',
    [ctx.userId],
  );
  const everyWeeks = profileRows[0]?.deload_every_weeks ?? 0;

  const { rows: last } = await ctx.db.query<{
    week_starting: string;
    training_weeks: number | null;
  }>(
    `select to_char(week_starting, 'YYYY-MM-DD') as week_starting, training_weeks
     from deloads where user_id = $1 order by week_starting desc limit 1`,
    [ctx.userId],
  );
  const lastDeload = last[0]?.week_starting ?? null;
  const activeThisWeek = lastDeload === thisWeek;

  // Distinct weeks with a finished session since the last light week, this one
  // included — "you have trained eight weeks running" is the reading a person
  // would give it. Counting sessions rather than weeks would make three
  // sessions in one week look like three weeks of training.
  const since = lastDeload ? addDays(lastDeload, 7) : '1970-01-01';
  const span = daySpanIn(timezone, since, addDays(thisWeek, 6));

  const { rows: weeks } = await ctx.db.query<{ n: number }>(
    `select count(distinct date_trunc('week', performed_at at time zone $4))::int as n
     from sessions
     where user_id = $1 and rpe is not null
       and performed_at >= $2 and performed_at < $3`,
    [ctx.userId, span.from, span.until, timezone],
  );

  return deloadStatus({
    trainingWeeks: weeks[0]?.n ?? 0,
    everyWeeks,
    activeThisWeek,
    earnedAfterWeeks: last[0]?.training_weeks ?? null,
  });
}

/**
 * Records this week as a light week when one is due. Called from the Today
 * payload, which is fetched every time he opens the app — so the deload lands
 * at the start of the week rather than whenever a job happens to run.
 */
export async function ensureDeload(ctx: Ctx, zone?: string): Promise<DeloadStatus> {
  const timezone = zone ?? (await athleteZone(ctx));
  const status = await currentDeload(ctx, timezone);
  if (!status.due) return status;

  await ctx.db.query(
    `insert into deloads (user_id, week_starting, training_weeks) values ($1, $2::date, $3)
     on conflict (user_id, week_starting) do nothing`,
    [ctx.userId, weekStarting(dayIn(timezone)), status.trainingWeeks],
  );

  return currentDeload(ctx, timezone);
}

/** Turning it off, or moving it. 0 disables scheduled deloads entirely. */
export async function setDeloadEvery(ctx: Ctx, weeks: number): Promise<DeloadStatus> {
  await ctx.db.query(
    'update profile set deload_every_weeks = $2, updated_at = now() where user_id = $1',
    [ctx.userId, Math.max(0, Math.min(52, Math.round(weeks)))],
  );
  return currentDeload(ctx);
}
