/**
 * The proactive schedule, and the sweep that drives it.
 *
 * These jobs send push notifications, which is the one part of the app that
 * reaches a person when they are not looking at it. Getting them wrong is
 * worse than not having them: a nudge at 01:30, or a second athlete receiving
 * Phil's morning check-in. No notification actually leaves here — with no
 * registered devices, sendPush returns without touching the network.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, daysAgo, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import { logMeal } from '../../services/meals';
import { setTimezone } from '../../services/profile';
import { createSession } from '../../services/sessions';
import { getToday } from '../../services/today';
import { recordSet } from '../../services/sets';
import { jobHandlers, logNudge, recentRuns } from '../handlers';
import { type JobHandler, forceRun, sweep } from '../scheduler';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
  // Both athletes are seeded with the full §8 schedule. Silence all of it so a
  // test only ever sees the job it asked for.
  await pool.query('update job_schedule set enabled = false');
});

const ok: JobHandler = async () => ({ status: 'sent' });

/** Makes one job due right now for this athlete, whatever the hour. */
async function scheduleNow(ctx: Ctx, job: string): Promise<void> {
  await pool.query(
    `insert into job_schedule (user_id, job, hour, minute, day_of_week, enabled)
     values ($1, $2, 0, 0, null, true)
     on conflict (user_id, job) do update set hour = 0, minute = 0, day_of_week = null,
       enabled = true`,
    [ctx.userId, job],
  );
}

async function runsFor(ctx: Ctx): Promise<{ job: string; status: string }[]> {
  const { rows } = await pool.query<{ job: string; status: string }>(
    'select job, status from job_runs where user_id = $1 order by job',
    [ctx.userId],
  );
  return rows;
}

describe('the sweep', () => {
  it('runs a due job for every athlete, each in their own slot', async () => {
    await scheduleNow(phil, 'morning_checkin');
    await scheduleNow(sam, 'morning_checkin');

    await sweep({ morning_checkin: ok });

    expect(await runsFor(phil)).toEqual([{ job: 'morning_checkin', status: 'sent' }]);
    expect(await runsFor(sam)).toEqual([{ job: 'morning_checkin', status: 'sent' }]);
  });

  it('does not run the same job twice in a day', async () => {
    await scheduleNow(phil, 'morning_checkin');
    let calls = 0;

    await sweep({ morning_checkin: async () => ((calls += 1), { status: 'sent' }) });
    await sweep({ morning_checkin: async () => ((calls += 1), { status: 'sent' }) });

    expect(calls).toBe(1);
  });

  it('holds a job until its hour, in the athlete\'s own timezone', async () => {
    // 04:00 UTC is 06:00 in Berlin — before the 07:30 check-in — and 16:00 in
    // Auckland, well after it. This is the whole reason the sweep resolves a
    // clock per athlete instead of reading the server's.
    await setTimezone(sam, 'Pacific/Auckland');
    await pool.query(
      `update job_schedule set hour = 7, minute = 30, day_of_week = null, enabled = true
       where job = 'morning_checkin'`,
    );

    await sweep({ morning_checkin: ok }, new Date('2026-09-02T04:00:00Z'));

    expect(await runsFor(phil)).toEqual([]);
    expect(await runsFor(sam)).toEqual([{ job: 'morning_checkin', status: 'sent' }]);
  });

  it('skips a job scheduled for another weekday', async () => {
    await pool.query(
      `update job_schedule set hour = 0, minute = 0, day_of_week = 0, enabled = true
       where job = 'weekly_review' and user_id = $1`,
      [phil.userId],
    );

    // 2026-09-02 is a Wednesday.
    await sweep({ weekly_review: ok }, new Date('2026-09-02T12:00:00Z'));

    expect(await runsFor(phil)).toEqual([]);
  });

  it('ignores a disabled job', async () => {
    await scheduleNow(phil, 'morning_checkin');
    await pool.query(
      `update job_schedule set enabled = false where user_id = $1 and job = 'morning_checkin'`,
      [phil.userId],
    );

    await sweep({ morning_checkin: ok });

    expect(await runsFor(phil)).toEqual([]);
  });

  it('releases the day\'s slot when a job says "not yet"', async () => {
    await scheduleNow(phil, 'log_nudge');

    await sweep({ log_nudge: async () => ({ status: 'skipped', retry: true }) });
    expect(await runsFor(phil)).toEqual([]);

    await sweep({ log_nudge: ok });
    expect(await runsFor(phil)).toEqual([{ job: 'log_nudge', status: 'sent' }]);
  });

  it('records a thrown job as failed rather than losing the sweep', async () => {
    await scheduleNow(phil, 'morning_checkin');
    await scheduleNow(sam, 'morning_checkin');

    await sweep({
      morning_checkin: async (ctx) => {
        if (ctx.userId === phil.userId) throw new Error('model outage');
        return { status: 'sent' };
      },
    });

    expect(await runsFor(phil)).toEqual([{ job: 'morning_checkin', status: 'failed' }]);
    // The other athlete's check-in still went out.
    expect(await runsFor(sam)).toEqual([{ job: 'morning_checkin', status: 'sent' }]);
  });

  it('ignores a scheduled job with no handler', async () => {
    await scheduleNow(phil, 'morning_checkin');

    await sweep({});

    expect(await runsFor(phil)).toEqual([]);
  });
});

describe('forceRun', () => {
  it('re-runs a job that already ran today', async () => {
    await scheduleNow(phil, 'morning_checkin');
    await sweep({ morning_checkin: ok });

    const result = await forceRun(phil, 'morning_checkin', async () => ({ status: 'forced' }));

    expect(result.status).toBe('forced');
    expect(await runsFor(phil)).toEqual([{ job: 'morning_checkin', status: 'forced' }]);
  });

  it('does not touch another athlete\'s run', async () => {
    await scheduleNow(sam, 'morning_checkin');
    await sweep({ morning_checkin: ok });

    await forceRun(phil, 'morning_checkin', async () => ({ status: 'forced' }));

    expect(await runsFor(sam)).toEqual([{ job: 'morning_checkin', status: 'sent' }]);
  });
});

describe('recentRuns', () => {
  it('shows only your own history', async () => {
    await scheduleNow(phil, 'morning_checkin');
    await scheduleNow(sam, 'dinner_prompt');
    await sweep({ morning_checkin: ok, dinner_prompt: ok });

    expect((await recentRuns(phil)).map((run) => run.job)).toEqual(['morning_checkin']);
    expect((await recentRuns(sam)).map((run) => run.job)).toEqual(['dinner_prompt']);
  });
});

describe('athletes who have gone quiet', () => {
  /** Pretend the app was last opened `days` ago. */
  async function lastOpened(days: number) {
    await pool.query(
      `update profile set last_seen_at = now() - ($2 || ' days')::interval where user_id = $1`,
      [phil.userId, days],
    );
  }

  it('still coaches somebody who was here yesterday', async () => {
    await lastOpened(1);

    const result = await jobHandlers.morning_checkin(phil);

    expect(result.detail?.coached).toBe(true);
  });

  it('stops paying for a note once nobody is reading it', async () => {
    await lastOpened(5);

    const result = await jobHandlers.morning_checkin(phil);

    // Still nudged — a notification is free and might bring them back — but
    // no model was asked to write anything.
    expect(result.detail?.coached).toBe(false);
    expect(result.status).not.toBe('skipped');
  });

  it('stops tapping the shoulder after a fortnight', async () => {
    await lastOpened(20);

    expect((await jobHandlers.morning_checkin(phil)).status).toBe('skipped');
    expect((await jobHandlers.dinner_prompt(phil)).status).toBe('skipped');
  });

  it('comes straight back when they open the app', async () => {
    await lastOpened(20);
    expect((await jobHandlers.morning_checkin(phil)).status).toBe('skipped');

    // getToday is what every launch calls, and what records the opening.
    await getToday(phil);

    const result = await jobHandlers.morning_checkin(phil);
    expect(result.status).not.toBe('skipped');
    expect(result.detail?.coached).toBe(true);
  });
});

describe('the dinner prompt', () => {
  it('says nothing when the day is already logged and on target', async () => {
    await logMeal(phil, { slot: 'breakfast', description: 'Skyr', proteinG: 100, kcal: 900 });
    await logMeal(phil, { slot: 'dinner', description: 'Chicken', proteinG: 85, kcal: 900 });

    const result = await jobHandlers.dinner_prompt(phil);

    expect(result.status).toBe('skipped');
  });

  it('asks what he ate when nothing is logged', async () => {
    const result = await jobHandlers.dinner_prompt(phil);

    // No devices registered, so nothing leaves — but it decided to send.
    expect(result.status).toBe('no_devices');
    expect(result.detail?.proteinLeft).toBe(190);
  });
});

describe('the log nudge', () => {
  it('waits when no session is open', async () => {
    const result = await logNudge(phil);

    expect(result).toMatchObject({ status: 'skipped', retry: true });
  });

  it('waits when he is already logging', async () => {
    const session = await createSession(phil, { template: 'A', performedAt: daysAgo(0, 0) });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    expect(await logNudge(phil)).toMatchObject({ status: 'skipped', retry: true });
  });

  it('waits until the session has been open ninety minutes', async () => {
    await createSession(phil, { template: 'A' });

    const result = await logNudge(phil);

    expect(result).toMatchObject({ status: 'skipped', retry: true });
    expect(Number(result.detail?.startedMinutes)).toBeLessThan(90);
  });

  it('nudges once the session has sat empty long enough', async () => {
    const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();
    await createSession(phil, { template: 'A', performedAt: twoHoursAgo });

    expect((await logNudge(phil)).status).toBe('no_devices');
  });
});
