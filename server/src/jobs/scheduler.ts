/**
 * A one-minute tick rather than a cron library.
 *
 * Cron libraries hold the schedule in memory, so a restart between 07:29 and
 * 07:31 silently skips the morning check-in. Here every run is recorded against
 * the day it covers, and the tick asks the database whether that run has
 * happened. A redeploy at 07:30 fires it late instead of never, and two ticks
 * in the same minute cannot double-send: the primary key on
 * (user_id, job, ran_for) refuses the second.
 *
 * The tick sweeps every athlete. "07:30" is 07:30 where each of them is, and
 * the day a run is filed under is their day — one person's morning is another's
 * middle of the night.
 */
import { type Ctx, ctxFor } from '../db';
import { dayIn, minutesOfDayIn, weekdayOf } from '../domain/time';
import { log } from '../logging';
import { athleteZone } from '../services/clock';
import { listUserIds } from '../services/users';

export type JobResult = {
  status: string;
  detail?: Record<string, unknown>;
  /**
   * true = nothing to do *yet*; release the day's slot so the next tick tries
   * again. Without this a job that is always "due" — the log nudge — would
   * claim the day on its first no-op tick and never fire.
   */
  retry?: boolean;
};
export type JobHandler = (ctx: Ctx) => Promise<JobResult>;

const TICK_MS = 60_000;

type ScheduleRow = {
  job: string;
  hour: number;
  minute: number;
  day_of_week: number | null;
  enabled: boolean;
};

type NowParts = { date: string; minutes: number; dow: number };

/**
 * The wall clock where this athlete is, not where the server is. A schedule row
 * saying 07:30 means 07:30 to them; read against the box's own clock it would
 * fire in the middle of someone's night.
 */
async function nowParts(ctx: Ctx, now: Date = new Date()): Promise<NowParts> {
  const zone = await athleteZone(ctx);
  const date = dayIn(zone, now);
  return { date, minutes: minutesOfDayIn(zone, now), dow: weekdayOf(date) };
}

async function due(
  ctx: Ctx,
  handlers: Record<string, JobHandler>,
  parts: NowParts,
): Promise<string[]> {
  const { date, minutes, dow } = parts;

  const { rows } = await ctx.db.query<ScheduleRow>(
    `select job, hour, minute, day_of_week, enabled
     from job_schedule where user_id = $1 and enabled`,
    [ctx.userId],
  );

  const ready: string[] = [];
  for (const row of rows) {
    if (!handlers[row.job]) continue;
    if (row.day_of_week !== null && row.day_of_week !== dow) continue;
    if (minutes < row.hour * 60 + row.minute) continue;

    const { rowCount } = await ctx.db.query(
      'select 1 from job_runs where user_id = $1 and job = $2 and ran_for = $3',
      [ctx.userId, row.job, date],
    );
    if (!rowCount) ready.push(row.job);
  }
  return ready;
}

async function run(
  ctx: Ctx,
  job: string,
  handler: JobHandler,
  parts: NowParts,
): Promise<void> {
  const { date } = parts;

  // Claim the slot first. If another process got here in the same minute its
  // insert wins and ours does nothing, so the work happens exactly once.
  const claim = await ctx.db.query(
    `insert into job_runs (user_id, job, ran_for, status) values ($1, $2, $3, 'running')
     on conflict (user_id, job, ran_for) do nothing`,
    [ctx.userId, job, date],
  );
  if (!claim.rowCount) return;

  try {
    const result = await handler(ctx);

    if (result.retry) {
      await ctx.db.query(
        'delete from job_runs where user_id = $1 and job = $2 and ran_for = $3',
        [ctx.userId, job, date],
      );
      return;
    }

    await ctx.db.query(
      `update job_runs set status = $4, detail = $5, ran_at = now()
       where user_id = $1 and job = $2 and ran_for = $3`,
      [ctx.userId, job, date, result.status, JSON.stringify(result.detail ?? {})],
    );
    log.info(
      { userId: ctx.userId, job, ranFor: date, status: result.status, detail: result.detail },
      'job finished',
    );
  } catch (error) {
    await ctx.db.query(
      `update job_runs set status = 'failed', detail = $4
       where user_id = $1 and job = $2 and ran_for = $3`,
      [ctx.userId, job, date, JSON.stringify({ error: (error as Error).message })],
    );
    log.error({ userId: ctx.userId, job, ranFor: date, err: error }, 'job failed');
  }
}

/**
 * One pass over every athlete. Exported so the sweep can be tested without
 * waiting on a timer.
 */
export async function sweep(
  handlers: Record<string, JobHandler>,
  now: Date = new Date(),
): Promise<void> {
  for (const userId of await listUserIds()) {
    const ctx = ctxFor(userId);
    try {
      // Read once per user per tick and reused: resolving the date twice could
      // straddle midnight and claim a slot for a day it had not checked.
      const parts = await nowParts(ctx, now);
      for (const job of await due(ctx, handlers, parts)) {
        await run(ctx, job, handlers[job]!, parts);
      }
    } catch (error) {
      // One athlete's bad tick must not stop everyone else's.
      log.error({ userId, err: error }, 'scheduler tick failed for user');
    }
  }
}

export function startScheduler(handlers: Record<string, JobHandler>): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await sweep(handlers);
    } catch (error) {
      // A scheduler that dies on one bad tick stops every future job.
      log.error({ err: error }, 'scheduler tick failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Used by the manual trigger so a job can be checked without waiting a week. */
export async function forceRun(
  ctx: Ctx,
  job: string,
  handler: JobHandler,
): Promise<JobResult> {
  const parts = await nowParts(ctx);
  const { date } = parts;
  await ctx.db.query('delete from job_runs where user_id = $1 and job = $2 and ran_for = $3', [
    ctx.userId,
    job,
    date,
  ]);
  await run(ctx, job, handler, parts);
  const { rows } = await ctx.db.query<{ status: string; detail: Record<string, unknown> }>(
    'select status, detail from job_runs where user_id = $1 and job = $2 and ran_for = $3',
    [ctx.userId, job, date],
  );
  return { status: rows[0]?.status ?? 'unknown', detail: rows[0]?.detail };
}
