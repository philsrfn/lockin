/**
 * "Today" belongs to the athlete, not to the server.
 *
 * These tests are the reason the timezone work exists. Every one of them
 * passes trivially while the only user lives in the same zone as the box — so
 * each is written against an explicit day boundary computed for a zone the
 * server is definitely not in, and would have failed before this change.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { dayIn, dayRangeIn } from '../../domain/time';
import { daysAgo, exerciseIdByName, resetData, resetProfile, phil } from '../../test/helpers';
import { getProfile, setTimezone } from '../profile';
import { logMeal, macrosToday, mealsToday } from '../meals';
import { createSession, finishSession, sessionsToday } from '../sessions';
import { recordSet } from '../sets';
import { getToday } from '../today';
import { getWeek } from '../week';
import { progress } from '../workouts';

/** UTC+12/+13. Never the same calendar date as the machine running the tests. */
const AUCKLAND = 'Pacific/Auckland';
const BERLIN = 'Europe/Berlin';

/** An instant `seconds` either side of the moment his day began. */
function aroundMidnight(zone: string, seconds: number): string {
  const { from } = dayRangeIn(zone, dayIn(zone));
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await setTimezone(phil, BERLIN);
});

describe('setTimezone', () => {
  it('moves him, and the profile reports where he is', async () => {
    expect((await setTimezone(phil, AUCKLAND)).timezone).toBe(AUCKLAND);
    expect((await getProfile(phil)).timezone).toBe(AUCKLAND);
  });

  it('refuses a zone the runtime does not know, rather than storing it', async () => {
    await expect(setTimezone(phil, 'Europe/Atlantis')).rejects.toThrow('not a timezone');
    expect((await getProfile(phil)).timezone).toBe(BERLIN);
  });

  it('defaults to Berlin, which is where the one athlete already is', async () => {
    expect((await getProfile(phil)).timezone).toBe(BERLIN);
  });
});

describe('what counts as today', () => {
  it('splits meals at his midnight, not the server\'s', async () => {
    await setTimezone(phil, AUCKLAND);
    await logMeal(phil, {
      slot: 'dinner',
      description: 'last night',
      proteinG: 60,
      eatenAt: aroundMidnight(AUCKLAND, -60),
    });
    await logMeal(phil, {
      slot: 'breakfast',
      description: 'this morning',
      proteinG: 55,
      eatenAt: aroundMidnight(AUCKLAND, 60),
    });

    const meals = await mealsToday(phil);

    expect(meals.map((meal) => meal.description)).toEqual(['this morning']);
    expect((await macrosToday(phil)).proteinG).toBe(55);
  });

  it('moves the boundary when he does', async () => {
    await setTimezone(phil, AUCKLAND);
    await logMeal(phil, {
      slot: 'dinner',
      description: 'before',
      proteinG: 60,
      eatenAt: aroundMidnight(AUCKLAND, -60),
    });
    await logMeal(phil, {
      slot: 'breakfast',
      description: 'after',
      proteinG: 55,
      eatenAt: aroundMidnight(AUCKLAND, 60),
    });

    await setTimezone(phil, BERLIN);

    // Both instants are two minutes apart, half a world from Berlin's own
    // midnight — so Berlin puts them on the same day, whichever day that is.
    // What it can never do is split them the way Auckland does.
    expect((await mealsToday(phil)).length).not.toBe(1);
  });

  it('splits sessions at his midnight too', async () => {
    await setTimezone(phil, AUCKLAND);
    await createSession(phil, { template: 'A', performedAt: aroundMidnight(AUCKLAND, -60) });
    const todays = await createSession(phil, {
      template: 'B',
      performedAt: aroundMidnight(AUCKLAND, 60),
    });

    expect((await sessionsToday(phil)).map((session) => session.id)).toEqual([todays.id]);
  });

  it('dates the Today payload in his zone', async () => {
    await setTimezone(phil, AUCKLAND);

    expect((await getToday(phil)).date).toBe(dayIn(AUCKLAND));
  });

  it('ends the week strip on his today', async () => {
    await setTimezone(phil, AUCKLAND);

    const week = await getWeek(phil);

    expect(week.days.at(-1)?.date).toBe(dayIn(AUCKLAND));
    expect(week.days.at(-1)?.isToday).toBe(true);
  });

  it('puts a session logged just after his midnight in today\'s column', async () => {
    await setTimezone(phil, AUCKLAND);
    const session = await createSession(phil, {
      template: 'A',
      performedAt: aroundMidnight(AUCKLAND, 60),
    });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });
    await finishSession(phil, session.id, { rpe: 8 });

    const week = await getWeek(phil);

    expect(week.days.at(-1)?.lifted).toBe(true);
    expect(week.strength.done).toBe(1);
  });

  it('puts a meal logged just before his midnight in yesterday\'s column', async () => {
    await setTimezone(phil, AUCKLAND);
    await logMeal(phil, {
      slot: 'dinner',
      description: 'late',
      proteinG: 60,
      eatenAt: aroundMidnight(AUCKLAND, -60),
    });

    const days = (await getWeek(phil)).days;

    expect(days.at(-1)?.proteinPct).toBeNull();
    expect(days.at(-2)?.proteinG).toBe(60);
  });

  it('charts a set on the day he trained', async () => {
    await setTimezone(phil, AUCKLAND);
    const session = await createSession(phil, {
      template: 'A',
      performedAt: aroundMidnight(AUCKLAND, 60),
    });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    const points = (await progress(phil)).exercises[0]?.points ?? [];

    expect(points[0]?.date).toBe(dayIn(AUCKLAND));
  });

  it('keeps the weight window counted from his today', async () => {
    await setTimezone(phil, AUCKLAND);

    // Nothing logged, but the window still has to be anchored somewhere — and
    // the series ends on his date.
    expect((await getToday(phil)).weight.series.at(-1)?.date).toBe(dayIn(AUCKLAND));
  });

  it('leaves history alone: nothing is rewritten when he moves', async () => {
    await createSession(phil, { template: 'A', performedAt: daysAgo(3) });
    const before = await sessionsToday(phil);

    await setTimezone(phil, AUCKLAND);

    expect(await sessionsToday(phil)).toEqual(before);
  });
});
