/**
 * A one-minute tick rather than a cron library.
 *
 * Cron libraries hold the schedule in memory, so a restart between 07:29 and
 * 07:31 silently skips the morning check-in. Here every run is recorded against
 * the day it covers, and the tick asks the database whether today's run has
 * happened. A redeploy at 07:30 fires it late instead of never, and two ticks
 * in the same minute cannot double-send: the primary key on (job, ran_for)
 * refuses the second.
 */
import { pool } from '../db';

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
export type JobHandler = () => Promise<JobResult>;

const TICK_MS = 60_000;

type ScheduleRow = {
  job: string;
  hour: number;
  minute: number;
  day_of_week: number | null;
  enabled: boolean;
};

/** Local wall-clock parts. TZ is Europe/Berlin in the container (§13). */
function nowParts(): { date: string; minutes: number; dow: number } {
  const now = new Date();
  return {
    date: now.toLocaleDateString('sv-SE'),
    minutes: now.getHours() * 60 + now.getMinutes(),
    dow: now.getDay(),
  };
}

async function due(handlers: Record<string, JobHandler>): Promise<string[]> {
  const { date, minutes, dow } = nowParts();

  const { rows } = await pool.query<ScheduleRow>(
    'select job, hour, minute, day_of_week, enabled from job_schedule where enabled',
  );

  const ready: string[] = [];
  for (const row of rows) {
    if (!handlers[row.job]) continue;
    if (row.day_of_week !== null && row.day_of_week !== dow) continue;
    if (minutes < row.hour * 60 + row.minute) continue;

    const { rowCount } = await pool.query('select 1 from job_runs where job = $1 and ran_for = $2', [
      row.job,
      date,
    ]);
    if (!rowCount) ready.push(row.job);
  }
  return ready;
}

async function run(job: string, handler: JobHandler): Promise<void> {
  const { date } = nowParts();

  // Claim the slot first. If another process got here in the same minute its
  // insert wins and ours does nothing, so the work happens exactly once.
  const claim = await pool.query(
    `insert into job_runs (job, ran_for, status) values ($1, $2, 'running')
     on conflict (job, ran_for) do nothing`,
    [job, date],
  );
  if (!claim.rowCount) return;

  try {
    const result = await handler();

    if (result.retry) {
      await pool.query('delete from job_runs where job = $1 and ran_for = $2', [job, date]);
      return;
    }

    await pool.query(
      'update job_runs set status = $3, detail = $4, ran_at = now() where job = $1 and ran_for = $2',
      [job, date, result.status, JSON.stringify(result.detail ?? {})],
    );
    console.log(`job ${job}: ${result.status}`);
  } catch (error) {
    await pool.query(
      'update job_runs set status = $3, detail = $4 where job = $1 and ran_for = $2',
      [job, date, 'failed', JSON.stringify({ error: (error as Error).message })],
    );
    console.error(`job ${job} failed:`, (error as Error).message);
  }
}

export function startScheduler(handlers: Record<string, JobHandler>): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      for (const job of await due(handlers)) {
        await run(job, handlers[job]!);
      }
    } catch (error) {
      // A scheduler that dies on one bad tick stops every future job.
      console.error('scheduler tick failed:', (error as Error).message);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Used by the manual trigger so a job can be re-run for testing. */
export async function forceRun(job: string, handler: JobHandler): Promise<JobResult> {
  const { date } = nowParts();
  await pool.query('delete from job_runs where job = $1 and ran_for = $2', [job, date]);
  await run(job, handler);
  const { rows } = await pool.query<{ status: string; detail: Record<string, unknown> }>(
    'select status, detail from job_runs where job = $1 and ran_for = $2',
    [job, date],
  );
  return { status: rows[0]?.status ?? 'unknown', detail: rows[0]?.detail };
}
