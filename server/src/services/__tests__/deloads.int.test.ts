/**
 * Scheduled light weeks, and the tape measure.
 *
 * progression.ts already deloads a movement after two failed sessions — that
 * is a repair. This is the other kind: the one that arrives while everything
 * still feels fine, because a programme run for a year needs it before the
 * wheels come off rather than after.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, daysAgo, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import { currentDeload, ensureDeload, setDeloadEvery, weekStarting } from '../deloads';
import { deleteMeasurement, listMeasurements, logMeasurement } from '../measurements';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';
import { planFor } from '../workouts';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await pool.query('update profile set deload_every_weeks = 8 where user_id = 1');
  sam = await anotherAthlete();
});

/** A finished session `daysBack` ago, at a known load. */
async function trained(daysBack: number, weightKg = 100, hour = 12) {
  const session = await createSession(phil, {
    template: 'A',
    performedAt: daysAgo(daysBack, hour),
  });
  await recordSet(phil, {
    sessionId: session.id,
    exerciseId: await exerciseIdByName('Back Squat'),
    setIndex: 1,
    weightKg,
    reps: 8,
  });
  await finishSession(phil, session.id, { rpe: 8 });
}

describe('weekStarting', () => {
  it('is the Monday of that week', () => {
    // 2026-09-02 is a Wednesday.
    expect(weekStarting('2026-09-02')).toBe('2026-08-31');
    expect(weekStarting('2026-08-31')).toBe('2026-08-31');
    // Sunday belongs to the week that began six days earlier.
    expect(weekStarting('2026-09-06')).toBe('2026-08-31');
  });
});

describe('when one is due', () => {
  it('is not due part-way through a block', async () => {
    await trained(3);

    const status = await currentDeload(phil);

    expect(status.due).toBe(false);
    expect(status.active).toBe(false);
  });

  it('counts weeks he trained, not sessions', async () => {
    // Three sessions on one day is one week of training, whatever weekday the
    // test happens to run on.
    await trained(0, 100, 8);
    await trained(0, 100, 13);
    await trained(0, 100, 18);

    expect((await currentDeload(phil)).trainingWeeks).toBe(1);
  });

  it('comes due after the configured number of training weeks', async () => {
    for (let week = 0; week < 8; week += 1) await trained(week * 7 + 1);

    expect((await currentDeload(phil)).due).toBe(true);
  });

  it('does not count a fortnight of travel as training', async () => {
    // Weeks with no session simply do not count — a break is its own deload.
    for (let week = 0; week < 4; week += 1) await trained(week * 7 + 1);

    expect((await currentDeload(phil)).trainingWeeks).toBe(4);
    expect((await currentDeload(phil)).due).toBe(false);
  });

  it('can be turned off entirely', async () => {
    for (let week = 0; week < 12; week += 1) await trained(week * 7 + 1);

    await setDeloadEvery(phil, 0);

    expect((await currentDeload(phil)).due).toBe(false);
  });
});

describe('running one', () => {
  beforeEach(async () => {
    for (let week = 0; week < 8; week += 1) await trained(week * 7 + 1);
    await ensureDeload(phil);
  });

  it('records the week and stops asking', async () => {
    const status = await currentDeload(phil);

    expect(status.active).toBe(true);
    expect(status.due).toBe(false);
  });

  it('says why, once', async () => {
    expect((await currentDeload(phil)).reason).toContain('Light week');
  });

  it('takes a tenth off the bar and a set off everywhere', async () => {
    const plan = await planFor(phil, 'A');
    const squat = plan.exercises[0]!;

    expect(plan.deload.active).toBe(true);
    expect(squat.reason).toBe('deload');
    expect(squat.weightKg).toBeLessThan(100);
    expect(squat.weightKg).toBeGreaterThan(85);
    expect(squat.sets).toBeLessThan(3);
  });

  it('rounds the reduction down, never back up into an increase', async () => {
    const squat = (await planFor(phil, 'A')).exercises[0]!;

    // 100 × 0.9 = 90, and the increment is 2.5 — but whatever the arithmetic,
    // a light week must not come out heavier than it started.
    expect(squat.weightKg).toBeLessThanOrEqual(90);
  });

  it('does not start a second one the same week', async () => {
    await ensureDeload(phil);

    const { rows } = await pool.query('select count(*)::int n from deloads where user_id = 1');
    expect(rows[0].n).toBe(1);
  });

  it('is per athlete', async () => {
    expect((await currentDeload(sam)).active).toBe(false);
  });
});

describe('measurements', () => {
  it('records a waist and nothing else', async () => {
    const measurement = await logMeasurement(phil, { waistCm: 96 });

    expect(measurement.waistCm).toBe(96);
    expect(measurement.chestCm).toBeNull();
  });

  it('does not erase this morning\'s chest when only the waist is measured', async () => {
    await logMeasurement(phil, { chestCm: 108, waistCm: 96 });

    const after = await logMeasurement(phil, { waistCm: 95 });

    expect(after.waistCm).toBe(95);
    expect(after.chestCm).toBe(108);
  });

  it('keeps one row per day', async () => {
    await logMeasurement(phil, { waistCm: 96 });
    await logMeasurement(phil, { waistCm: 95 });

    expect(await listMeasurements(phil)).toHaveLength(1);
  });

  it('lists newest first', async () => {
    await logMeasurement(phil, { measuredOn: '2026-08-01', waistCm: 99 });
    await logMeasurement(phil, { measuredOn: '2026-09-01', waistCm: 96 });

    expect((await listMeasurements(phil, 1000)).map((m) => m.waistCm)).toEqual([96, 99]);
  });

  it.each([
    ['nothing at all', {}, 'Nothing to record'],
    ['a slipped decimal', { waistCm: 9 }, 'must be between'],
    ['a date that is not a date', { waistCm: 96, measuredOn: '01.09.2026' }, 'YYYY-MM-DD'],
  ])('refuses %s', async (_label, input, message) => {
    await expect(logMeasurement(phil, input)).rejects.toThrow(message);
  });

  it('takes a note with no numbers', async () => {
    const measurement = await logMeasurement(phil, { notes: 'jeans fit again' });

    expect(measurement.notes).toBe('jeans fit again');
  });

  it('deletes a day', async () => {
    const measurement = await logMeasurement(phil, { waistCm: 96 });

    await deleteMeasurement(phil, measurement.measuredOn);

    expect(await listMeasurements(phil)).toEqual([]);
  });

  it('is per athlete', async () => {
    await logMeasurement(phil, { waistCm: 96 });

    expect(await listMeasurements(sam)).toEqual([]);
  });
});
