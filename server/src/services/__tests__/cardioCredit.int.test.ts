/**
 * Cardio moving the day's calorie target, against a real database.
 *
 * The arithmetic is covered without one in `domain/__tests__/cardioBurn.test.ts`.
 * What matters here is that the setting is actually respected, that the
 * credit reaches the number the athlete reads, and that it is the same number
 * everywhere — a day where the home screen says 2300 and the trainer thinks
 * 2578 is worse than one where cardio never counted at all.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { logCardio } from '../cardio';
import { logWeight } from '../bodyweight';
import { getProfile, setCardioAddsCalories } from '../profile';
import { todaysTargets } from '../dailyTargets';
import { getToday } from '../today';

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await logWeight(phil, { weightKg: 95 });
});

const targets = async () => todaysTargets(phil, await getProfile(phil), 'Europe/Berlin');
const ranToday = () => logCardio(phil, { kind: 'zone2', minutes: 45 });

describe('with the setting off, which is the default', () => {
  it('leaves the target exactly where it was', async () => {
    await ranToday();

    const today = await targets();

    expect(today.kcal).toBe((await getProfile(phil)).calorieTarget);
    expect(today.cardioCreditKcal).toBe(0);
  });

  it('is off for a profile that has never been asked', async () => {
    // Nobody's target moves because of a deploy.
    expect((await getProfile(phil)).cardioAddsCalories).toBe(false);
  });
});

describe('with the setting on', () => {
  beforeEach(() => setCardioAddsCalories(phil, true));

  it('does nothing on a day with no cardio', async () => {
    const today = await targets();

    expect(today.cardioCreditKcal).toBe(0);
    expect(today.kcal).toBe((await getProfile(phil)).calorieTarget);
  });

  it('raises the target on a day with a session in it', async () => {
    const before = (await targets()).kcal;
    await ranToday();

    const after = await targets();

    expect(after.cardioCreditKcal).toBeGreaterThan(0);
    expect(after.kcal).toBe(before + after.cardioCreditKcal);
  });

  it('reaches the number the home screen shows', async () => {
    await ranToday();

    const today = await getToday(phil);

    expect(today.macros.targets.cardioCreditKcal).toBeGreaterThan(0);
    expect(today.macros.remaining.kcal).toBe(
      today.macros.targets.kcal - today.macros.consumed.kcal,
    );
  });

  it('scales with the body doing it', async () => {
    await ranToday();
    const heavier = (await targets()).cardioCreditKcal;

    await pool.query('update bodyweight set weight_kg = 60 where user_id = $1', [phil.userId]);
    const lighter = (await targets()).cardioCreditKcal;

    expect(lighter).toBeLessThan(heavier);
  });

  it('gives nothing when there has never been a weigh-in', async () => {
    // Every number in the burn scales with weight, and a guessed body is a
    // guessed meal.
    await pool.query('delete from bodyweight where user_id = $1', [phil.userId]);
    await ranToday();

    expect((await targets()).cardioCreditKcal).toBe(0);
  });

  it('does not count yesterday session', async () => {
    await logCardio(phil, {
      kind: 'zone2',
      minutes: 45,
      performedAt: new Date(Date.now() - 36 * 3600_000).toISOString(),
    });

    expect((await targets()).cardioCreditKcal).toBe(0);
  });

  it('never counts another athlete cardio', async () => {
    const sam = await anotherAthlete();
    await logCardio(sam, { kind: 'zone2', minutes: 90 });

    expect((await targets()).cardioCreditKcal).toBe(0);
  });
});
