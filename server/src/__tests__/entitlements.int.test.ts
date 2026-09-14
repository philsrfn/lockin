/**
 * The gate in front of the trainer, against a real database.
 *
 * The rule is covered without one in `domain/__tests__/entitlement.test.ts`.
 * What matters here is the line itself: that the expensive routes are behind
 * it, that the rest of the app is not, and that a lapsed account never loses
 * hold of anything it put in.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../test/helpers';
import { accessForAthlete, entitlementFor, grant } from '../services/entitlements';
import { logWeight } from '../services/bodyweight';
import { logMeal, mealsToday } from '../services/meals';
import { exportEverything } from '../services/export';
import { getToday } from '../services/today';
import { trainingHistory } from '../services/history';

beforeEach(async () => {
  await resetData();
  await resetProfile();
});

/** Nothing about the athlete changes; only what they are entitled to. */
const lapse = () =>
  pool.query(
    `update entitlements set kind = 'paid', expires_at = now() - interval '1 day'
     where user_id = $1`,
    [phil.userId],
  );

describe('a new account', () => {
  it('starts on a trial rather than on nothing', async () => {
    const sam = await anotherAthlete();

    expect(await entitlementFor(sam)).toMatchObject({ kind: 'trial' });
    expect((await accessForAthlete(sam)).coach).toBe(true);
  });

  it('gets it in the same breath as the profile, so there is no gap', async () => {
    // A missing entitlement means no trainer. Somebody's first minute in the
    // app is not the moment to discover a race between two writes.
    const sam = await anotherAthlete();
    const { rows } = await pool.query(
      'select 1 from profile p join entitlements e on e.user_id = p.user_id where p.user_id = $1',
      [sam.userId],
    );

    expect(rows).toHaveLength(1);
  });
});

describe('when it has lapsed', () => {
  beforeEach(lapse);

  it('closes the trainer', async () => {
    expect((await accessForAthlete(phil)).coach).toBe(false);
  });

  it('still lets them log', async () => {
    // What costs money to run is the model. What somebody paid for with months
    // of their own attention is the data.
    await expect(logWeight(phil, { weightKg: 95 })).resolves.toBeDefined();
    await expect(
      logMeal(phil, { slot: 'lunch', description: 'Skyr', kcal: 300, proteinG: 30 }),
    ).resolves.toBeDefined();
  });

  it('still lets them read what is there', async () => {
    await logWeight(phil, { weightKg: 95 });

    await expect(getToday(phil)).resolves.toBeDefined();
    await expect(trainingHistory(phil, 30)).resolves.toBeDefined();
    await expect(mealsToday(phil)).resolves.toBeDefined();
  });

  it('still lets them take everything with them', async () => {
    // Article 20 does not pause when a subscription does.
    await logWeight(phil, { weightKg: 95 });

    const { data } = await exportEverything(phil);

    expect(data.bodyweight).toHaveLength(1);
  });
});

describe('an operator granting one', () => {
  it('reopens the trainer', async () => {
    await lapse();
    await grant(phil.userId, phil.userId, { kind: 'paid', days: 30 });

    expect((await accessForAthlete(phil)).coach).toBe(true);
  });

  it('records who decided it', async () => {
    await grant(phil.userId, phil.userId, { kind: 'comped', days: null });

    const { rows } = await pool.query<{ action: string }>(
      'select action from admin_actions where subject_id = $1',
      [phil.userId],
    );

    expect(rows.map((row) => row.action)).toContain('entitle');
  });

  it('refuses a paid entitlement that would never end', async () => {
    // Only comped is allowed to run forever. A paid one with no expiry is a
    // subscription nobody is paying for.
    await expect(grant(phil.userId, phil.userId, { kind: 'paid', days: null })).rejects.toThrow(
      /forever/i,
    );
  });

  it('never touches another athlete', async () => {
    const sam = await anotherAthlete();
    await lapse();
    await grant(phil.userId, sam.userId, { kind: 'comped', days: null });

    expect((await accessForAthlete(phil)).coach).toBe(false);
    expect((await accessForAthlete(sam)).coach).toBe(true);
  });
});
