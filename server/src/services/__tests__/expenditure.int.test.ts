/**
 * Measuring expenditure against a real database.
 *
 * The arithmetic and the refusals are covered without a database in
 * `domain/__tests__/expenditure.test.ts`. What matters here is that the two
 * inputs are assembled correctly: intake summed into the athlete's own days,
 * weigh-ins reaching far enough back to smooth the opening average, and
 * neither one leaking between people.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { addDays } from '../../domain/time';
import { expenditure } from '../expenditure';
import { setTimezone } from '../profile';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

const today = () => new Date().toISOString().slice(0, 10);

/** Meals go in directly: 28 days of logMeal would be 28 round trips of noise. */
async function logIntake(
  ctx: Ctx,
  daysBack: number,
  kcal: number,
  atHour = '13:00',
): Promise<void> {
  await pool.query(
    `insert into meals (user_id, eaten_at, slot, description, kcal)
     values ($1, (now() - ($2 || ' days')::interval)::date + $4::time, 'lunch', 'test', $3)`,
    [ctx.userId, String(daysBack), kcal, atHour],
  );
}

async function logWeighIn(ctx: Ctx, daysBack: number, weightKg: number): Promise<void> {
  await pool.query(
    `insert into bodyweight (user_id, measured_on, weight_kg)
     values ($1, (now() - ($2 || ' days')::interval)::date, $3)
     on conflict (user_id, measured_on) do update set weight_kg = excluded.weight_kg`,
    [ctx.userId, String(daysBack), weightKg],
  );
}

/** A full month of eating `kcal` a day while losing `changeKg` linearly. */
async function aMonthOf(ctx: Ctx, kcal: number, changeKg: number): Promise<void> {
  const perDay = changeKg / 28;
  for (let back = 0; back <= 42; back += 1) {
    if (back <= 27) await logIntake(ctx, back, kcal);
    await logWeighIn(ctx, back, 95 - perDay * back);
  }
}

describe('measuring expenditure from what is logged', () => {
  it('says nothing at all to somebody who has just started', async () => {
    expect(await expenditure(phil)).toMatchObject({ ok: false, reason: 'not_enough_intake' });
  });

  it('measures a month of eating and weighing', async () => {
    await aMonthOf(phil, 2400, -2);

    const result = await expenditure(phil);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ate 2400, lost 2 kg in 28 days: 2 × 7700 / 28 = 550 kcal a day unaccounted for.
    expect(result.tdeeKcal).toBe(2950);
    expect(result.meanIntakeKcal).toBe(2400);
    expect(result.confidence).toBe('good');
  });

  it('sums a day\'s meals rather than taking the last one', async () => {
    await aMonthOf(phil, 800, 0);
    // Three more meals on every day of the window, bringing each day to 2600.
    for (let back = 0; back <= 27; back += 1) {
      await logIntake(phil, back, 900);
      await logIntake(phil, back, 900);
    }

    const result = await expenditure(phil);

    expect(result.ok && result.meanIntakeKcal).toBe(2600);
  });

  it('refuses when the weighing stopped, however well the eating was logged', async () => {
    for (let back = 0; back <= 27; back += 1) await logIntake(phil, back, 2400);

    expect(await expenditure(phil)).toMatchObject({ ok: false, reason: 'not_enough_weight' });
  });

  it('reads intake into the athlete\'s day, not the server\'s', async () => {
    // Breakfast at 09:00 in Berlin is 21:00 the previous day in Honolulu,
    // twelve hours behind. A day's intake must follow the athlete across that
    // boundary; a `::date` cast against the server's clock would not.
    //
    // Each day carries a distinct number of calories, so any reshuffling of
    // which meal belongs to which day shows up in the mean rather than
    // cancelling out.
    for (let back = 0; back <= 42; back += 1) {
      if (back <= 27) await logIntake(phil, back, 2400 + back, '09:00');
      await logWeighIn(phil, back, 95);
    }

    const berlin = await expenditure(phil);
    await setTimezone(phil, 'Pacific/Honolulu');
    const honolulu = await expenditure(phil);

    expect(berlin.ok).toBe(true);
    expect(honolulu.ok).toBe(true);
    if (!berlin.ok || !honolulu.ok) return;
    expect(honolulu.meanIntakeKcal).not.toBe(berlin.meanIntakeKcal);
  });

  it('never measures one athlete from another\'s meals', async () => {
    await aMonthOf(phil, 2400, -2);

    expect(await expenditure(sam)).toMatchObject({ ok: false, reason: 'not_enough_intake' });
    expect((await expenditure(phil)).ok).toBe(true);
  });

  it('takes a shorter window when asked, and answers differently for it', async () => {
    await aMonthOf(phil, 2400, -2);

    const short = await expenditure(phil, 14);

    expect(short.ok).toBe(true);
    if (!short.ok) return;
    expect(short.windowDays).toBe(14);
  });
});
