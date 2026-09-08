/**
 * Past training, as the History screen reads it.
 *
 * The domain tests cover grouping and summarising with no database in sight.
 * What is worth checking here is everything they cannot: that a lift and a
 * run on the same day arrive together, that the window is respected, that the
 * day boundary is the athlete's and not the server's, and that one person's
 * history is never another's.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import { dayIn } from '../../domain/time';
import { logCardio } from '../cardio';
import { trainingHistory } from '../history';
import { setTimezone } from '../profile';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

/** A finished session with two sets, backdated by whole days. */
async function lifted(
  ctx: Ctx,
  { daysAgo = 0, weightKg = 90, reps = 8, exercise = 'Back Squat' } = {},
): Promise<number> {
  const session = await createSession(ctx, { template: 'A' });
  const exerciseId = await exerciseIdByName(exercise);
  await recordSet(ctx, { sessionId: session.id, exerciseId, setIndex: 1, weightKg, reps });
  await recordSet(ctx, { sessionId: session.id, exerciseId, setIndex: 2, weightKg, reps });
  await finishSession(ctx, session.id, { rpe: 8 });

  if (daysAgo > 0) {
    await pool.query(
      `update sessions set performed_at = now() - ($2 || ' days')::interval where id = $1`,
      [session.id, String(daysAgo)],
    );
  }
  return session.id;
}

describe('reading back what was done', () => {
  it('has nothing to show somebody who has never trained', async () => {
    const history = await trainingHistory(phil, 30);

    expect(history.days).toEqual([]);
    expect(history.totals).toMatchObject({ sessions: 0, setCount: 0, totalVolumeKg: 0 });
  });

  it('summarises a session down to the row the screen draws', async () => {
    await lifted(phil, { weightKg: 92.5, reps: 6 });

    const [day] = (await trainingHistory(phil, 30)).days;
    const session = day?.sessions[0];

    expect(session?.summary).toMatchObject({
      setCount: 2,
      totalVolumeKg: Math.round(92.5 * 6 * 2),
    });
    expect(session?.summary.exercises[0]).toMatchObject({
      exerciseName: 'Back Squat',
      sets: 2,
      topWeightKg: 92.5,
      topReps: 6,
    });
  });

  it('keeps the sets, so tapping a session does not need a second request', async () => {
    await lifted(phil);

    const session = (await trainingHistory(phil, 30)).days[0]?.sessions[0];

    expect(session?.sets).toHaveLength(2);
    expect(session?.sets[0]?.exerciseName).toBe('Back Squat');
  });

  it('shows a lift and a run on the same day as one day', async () => {
    await lifted(phil);
    await logCardio(phil, { kind: 'zone2', minutes: 35 });

    const history = await trainingHistory(phil, 30);

    expect(history.days).toHaveLength(1);
    expect(history.days[0]?.sessions).toHaveLength(1);
    expect(history.days[0]?.cardio).toHaveLength(1);
  });

  it('counts cardio in the totals, because a week is lifts and cardio', async () => {
    await lifted(phil);
    await logCardio(phil, { kind: 'zone2', minutes: 35 });
    await logCardio(phil, { kind: 'walk', minutes: 20 });

    expect((await trainingHistory(phil, 30)).totals).toMatchObject({
      sessions: 1,
      cardioSessions: 2,
      cardioMinutes: 55,
    });
  });

  it('stops at the window it was asked for', async () => {
    await lifted(phil, { daysAgo: 3 });
    await lifted(phil, { daysAgo: 40 });

    expect((await trainingHistory(phil, 7)).days).toHaveLength(1);
    expect((await trainingHistory(phil, 90)).days).toHaveLength(2);
  });

  it('files a late session by the athlete\'s day, not the server\'s', async () => {
    // 23:30 in Berlin is already tomorrow in Auckland. Which day this lands on
    // is the athlete's business, and the profile is where that is recorded.
    const id = await lifted(phil);
    await pool.query(`update sessions set performed_at = $2 where id = $1`, [
      id,
      '2026-09-03T21:30:00Z',
    ]);

    await setTimezone(phil, 'Europe/Berlin');
    expect((await trainingHistory(phil, 365)).days[0]?.day).toBe('2026-09-03');

    await setTimezone(phil, 'Pacific/Auckland');
    expect((await trainingHistory(phil, 365)).days[0]?.day).toBe('2026-09-04');
  });

  it('says which day is today, in the athlete\'s zone and not the server\'s', async () => {
    // The screen labels the first rows "Today" and "Yesterday". Deriving that
    // from the phone would disagree with the grouping done here the moment
    // somebody's profile zone and their handset differ.
    // Checked against the same helper the service uses rather than against
    // the other zone: Auckland and Honolulu are 22 hours apart, so they share
    // a calendar date for two hours of every day. Asserting they always
    // differ made this test pass for 22 hours and fail for two.
    await setTimezone(phil, 'Pacific/Auckland');
    expect((await trainingHistory(phil, 30)).today).toBe(dayIn('Pacific/Auckland'));

    await setTimezone(phil, 'Pacific/Honolulu');
    expect((await trainingHistory(phil, 30)).today).toBe(dayIn('Pacific/Honolulu'));
  });

  it('never shows one athlete another\'s training', async () => {
    await lifted(phil);
    await logCardio(phil, { kind: 'zone2', minutes: 35 });

    const theirs = await trainingHistory(sam, 30);

    expect(theirs.days).toEqual([]);
    expect((await trainingHistory(phil, 30)).days).toHaveLength(1);
  });
});
