/**
 * Two athletes, one database.
 *
 * This is the file the whole tenancy change exists for. A missing `where
 * user_id` does not throw — it returns somebody else's rows, looking perfectly
 * normal, and nobody notices until it is a story. So every read is checked from
 * both sides, and every cross-tenant id is checked to read as missing rather
 * than as forbidden: he cannot tell whether it exists, and it is not his either
 * way.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import {
  anotherAthlete,
  contextIdByName,
  exerciseIdByName,
  isoDaysAgo,
  phil,
  resetData,
  resetProfile,
} from '../../test/helpers';
import { listEntries, logWeight, summary } from '../bodyweight';
import { activateContext, activeContext, listContexts } from '../contexts';
import { archiveFood, createFood, getFood, listFoods } from '../foods';
import { deleteMeal, logMeal, macrosToday, mealsToday } from '../meals';
import { getProfile, setTimezone, updateTargets } from '../profile';
import { addRule, deactivateRule, listRules } from '../rules';
import { createSession, finishSession, getSession, listSessions } from '../sessions';
import { deleteSet, recordSet } from '../sets';
import { drain } from '../sync';
import { getToday } from '../today';
import { findUserByToken, provisionUser } from '../users';
import { getWeek } from '../week';
import { progress } from '../workouts';
import { listTokens, registerToken } from '../../push';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

describe('provisioning', () => {
  it('gives a new athlete everything they need to open the app', async () => {
    const profile = await getProfile(sam);
    expect(profile.name).toBe('Sam');
    expect(profile.calorieTarget).toBeGreaterThanOrEqual(1800);

    expect((await activeContext(sam))?.name).toBe('Home');
    expect((await listRules(sam)).length).toBeGreaterThan(0);
  });

  it('does not hand a stranger Phil\'s cities or his Skyr', async () => {
    expect((await listContexts(sam)).map((context) => context.name)).toEqual(['Home']);
    expect(await listFoods(sam)).toEqual([]);
    expect((await listRules(sam)).some((rule) => rule.text.includes('Skyr'))).toBe(false);
  });

  it('resolves a token to its own athlete', async () => {
    const { user } = await provisionUser({ name: 'Alex', token: 'alex-token' });

    expect((await findUserByToken('alex-token'))?.id).toBe(user.id);
    expect(await findUserByToken('not-a-token')).toBeNull();
  });
});

describe('training history', () => {
  it('keeps sessions apart', async () => {
    await createSession(phil, { template: 'A' });
    await createSession(sam, { template: 'B' });

    expect((await listSessions(phil)).map((s) => s.template)).toEqual(['A']);
    expect((await listSessions(sam)).map((s) => s.template)).toEqual(['B']);
  });

  it('reads another athlete\'s session id as missing', async () => {
    const his = await createSession(phil, { template: 'A' });

    await expect(getSession(sam, his.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to finish a session that is not yours', async () => {
    const his = await createSession(phil, { template: 'A' });

    await expect(finishSession(sam, his.id, { rpe: 8 })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await getSession(phil, his.id)).finished).toBe(false);
  });

  it('refuses to record a set against someone else\'s session', async () => {
    const his = await createSession(phil, { template: 'A' });

    await expect(
      recordSet(sam, {
        sessionId: his.id,
        exerciseId: await exerciseIdByName('Back Squat'),
        setIndex: 1,
        weightKg: 90,
        reps: 8,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect((await getSession(phil, his.id)).sets).toEqual([]);
  });

  it('refuses to delete someone else\'s set', async () => {
    const his = await createSession(phil, { template: 'A' });
    const { setId } = await recordSet(phil, {
      sessionId: his.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    await expect(deleteSet(sam, setId)).rejects.toMatchObject({ statusCode: 404 });
    expect((await getSession(phil, his.id)).sets).toHaveLength(1);
  });

  it('does not let one athlete\'s sets reach another\'s progress chart', async () => {
    const session = await createSession(phil, { template: 'A' });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    expect((await progress(phil)).setCount).toBe(1);
    expect((await progress(sam)).setCount).toBe(0);
  });

  it('shares the exercise catalog, which belongs to nobody', async () => {
    // A movement is not personal data. Both athletes squat.
    const squat = await exerciseIdByName('Back Squat');
    const session = await createSession(sam, { template: 'A' });

    const result = await recordSet(sam, {
      sessionId: session.id,
      exerciseId: squat,
      setIndex: 1,
      weightKg: 60,
      reps: 8,
    });

    expect(result.session.sets[0]?.exerciseName).toBe('Back Squat');
  });
});

describe('bodyweight', () => {
  it('lets both weigh in on the same morning — the old primary key could not', async () => {
    await logWeight(phil, { measuredOn: isoDaysAgo(0), weightKg: 99 });
    await logWeight(sam, { measuredOn: isoDaysAgo(0), weightKg: 71 });

    expect((await listEntries(phil, 7)).map((e) => e.weightKg)).toEqual([99]);
    expect((await listEntries(sam, 7)).map((e) => e.weightKg)).toEqual([71]);
  });

  it('keeps the trend and the goal weight separate', async () => {
    await logWeight(phil, { weightKg: 99 });

    expect((await summary(phil)).latest?.weightKg).toBe(99);
    expect((await summary(sam)).latest).toBeNull();
  });
});

describe('food', () => {
  it('lets both keep a food of the same name', async () => {
    const his = await createFood(phil, { name: 'Skyr breakfast', kcal: 520, proteinG: 55 });
    const hers = await createFood(sam, { name: 'Skyr breakfast', kcal: 300, proteinG: 30 });

    expect(hers.id).not.toBe(his.id);
    expect((await getFood(phil, his.id)).kcal).toBe(520);
    expect((await getFood(sam, hers.id)).kcal).toBe(300);
  });

  it('reads another athlete\'s food as missing, and will not archive it', async () => {
    const his = await createFood(phil, { name: 'Skyr breakfast', kcal: 520, proteinG: 55 });

    await expect(getFood(sam, his.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(archiveFood(sam, his.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await listFoods(phil)).toHaveLength(1);
  });

  it('keeps meals and the day\'s totals apart', async () => {
    await logMeal(phil, { slot: 'breakfast', description: 'Skyr', proteinG: 55, kcal: 520 });
    await logMeal(sam, { slot: 'lunch', description: 'Salad', proteinG: 20, kcal: 300 });

    expect((await macrosToday(phil)).proteinG).toBe(55);
    expect((await macrosToday(sam)).proteinG).toBe(20);
    expect((await mealsToday(sam)).map((meal) => meal.description)).toEqual(['Salad']);
  });

  it('refuses to delete someone else\'s meal', async () => {
    const meal = await logMeal(phil, { slot: 'breakfast', description: 'Skyr', proteinG: 55 });

    await expect(deleteMeal(sam, meal.meal.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await mealsToday(phil)).toHaveLength(1);
  });
});

describe('settings and rules', () => {
  it('keeps targets separate, floors and all', async () => {
    await updateTargets(phil, { calorieTarget: 2100 });

    expect((await getProfile(phil)).calorieTarget).toBe(2100);
    expect((await getProfile(sam)).calorieTarget).toBe(2300);
  });

  it('lets each athlete live in their own timezone', async () => {
    await setTimezone(sam, 'America/New_York');

    expect((await getProfile(sam)).timezone).toBe('America/New_York');
    expect((await getProfile(phil)).timezone).toBe('Europe/Berlin');
  });

  it('keeps rules apart, and will not let one deactivate another\'s', async () => {
    const added = await addRule(phil, { tier: 'soft', text: 'Prefer oat milk' });

    await expect(deactivateRule(sam, added.rule.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await listRules(phil)).find((rule) => rule.id === added.rule.id)?.active).toBe(true);
  });

  it('switches only your own city', async () => {
    const leipzig = await contextIdByName('City C');

    await expect(activateContext(sam, leipzig)).rejects.toMatchObject({ statusCode: 404 });
    expect((await activeContext(phil))?.name).toBe('Home');
  });

  it('keeps two people\'s active contexts independent', async () => {
    await activateContext(phil, await contextIdByName('City C'));

    expect((await activeContext(phil))?.name).toBe('City C');
    expect((await activeContext(sam))?.name).toBe('Home');
  });
});

describe('the offline queue', () => {
  it('does not hand one phone another phone\'s stored result', async () => {
    const clientId = randomUUID();

    const his = await drain(phil, [
      { clientId, op: 'create_session', payload: { template: 'A' } },
    ]);
    const hers = await drain(sam, [
      { clientId, op: 'create_session', payload: { template: 'C' } },
    ]);

    // Same client uuid, two athletes: both must apply, not the second read as
    // a duplicate of the first.
    expect(his[0]?.status).toBe('applied');
    expect(hers[0]?.status).toBe('applied');
    expect((hers[0]?.data as { id: number }).id).not.toBe((his[0]?.data as { id: number }).id);
    expect((await listSessions(sam)).map((s) => s.template)).toEqual(['C']);
  });

  it('will not resolve a set against a session another athlete synced', async () => {
    const sessionClientId = randomUUID();
    await drain(phil, [
      { clientId: sessionClientId, op: 'create_session', payload: { template: 'A' } },
    ]);

    const [result] = await drain(sam, [
      {
        clientId: randomUUID(),
        op: 'record_set',
        payload: {
          sessionClientId,
          exerciseId: await exerciseIdByName('Back Squat'),
          setIndex: 1,
          weightKg: 90,
          reps: 8,
        },
      },
    ]);

    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('No synced session');
  });
});

describe('the screens', () => {
  it('builds each athlete their own week', async () => {
    const session = await createSession(phil, { template: 'A' });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });
    await finishSession(phil, session.id, { rpe: 8 });
    await logWeight(phil, { weightKg: 99 });

    const [his, hers] = await Promise.all([getWeek(phil), getWeek(sam)]);

    expect(his.strength.done).toBe(1);
    expect(his.weighIns.done).toBe(1);
    expect(hers.strength.done).toBe(0);
    expect(hers.weighIns.done).toBe(0);
  });

  it('builds each athlete their own Today', async () => {
    await logMeal(phil, { slot: 'breakfast', description: 'Skyr', proteinG: 55, kcal: 520 });

    const [his, hers] = await Promise.all([getToday(phil), getToday(sam)]);

    expect(his.profile.name).toBe('Phil');
    expect(hers.profile.name).toBe('Sam');
    expect(his.macros.consumed.proteinG).toBe(55);
    expect(hers.macros.consumed.proteinG).toBe(0);
    expect(hers.macros.meals).toEqual([]);
  });
});

describe('push', () => {
  it('addresses a notification rather than broadcasting it', async () => {
    // Before this change every push went to every registered device in the
    // system — a second athlete would have received Phil's 07:30 nudge.
    await registerToken(phil, 'ExponentPushToken[phil]', 'ios');
    await registerToken(sam, 'ExponentPushToken[sam]', 'ios');

    expect(await listTokens(phil)).toEqual(['ExponentPushToken[phil]']);
    expect(await listTokens(sam)).toEqual(['ExponentPushToken[sam]']);
  });

  it('lets a device change hands without leaking the new owner\'s pushes', async () => {
    await registerToken(phil, 'ExponentPushToken[device]', 'ios');
    await registerToken(sam, 'ExponentPushToken[device]', 'ios');

    expect(await listTokens(phil)).toEqual([]);
    expect(await listTokens(sam)).toEqual(['ExponentPushToken[device]']);
  });
});
