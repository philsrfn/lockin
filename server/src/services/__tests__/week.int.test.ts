/**
 * The week, and the Today payload built on top of it.
 *
 * Home is the week (§11 as reworked): a seven-day strip is the subject of the
 * screen, so what it says has to be exactly true. The distinction that matters
 * most here is absent versus zero — a day he did not log is not a day he ate
 * no protein, and drawing it as zero would invent a failure.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isoDaysAgo, resetData, resetProfile, phil } from '../../test/helpers';
import { logWeight } from '../bodyweight';
import { logMeal } from '../meals';
import { createSession, finishSession } from '../sessions';
import { getToday } from '../today';
import { getWeek } from '../week';
import { daysAgo, exerciseIdByName } from '../../test/helpers';
import { recordSet } from '../sets';

beforeEach(async () => {
  await resetData();
  await resetProfile();
});

async function finishedSession(template: 'A' | 'B' | 'C', daysBack: number) {
  const session = await createSession(phil, { template, performedAt: daysAgo(daysBack) });
  await recordSet(phil, {
    sessionId: session.id,
    exerciseId: await exerciseIdByName('Back Squat'),
    setIndex: 1,
    weightKg: 90,
    reps: 8,
  });
  await finishSession(phil, session.id, { rpe: 8 });
  return session;
}

describe('getWeek', () => {
  it('always returns seven days, ending today', async () => {
    const week = await getWeek(phil);

    expect(week.days).toHaveLength(7);
    expect(week.days.at(-1)?.date).toBe(isoDaysAgo(0));
    expect(week.days.at(-1)?.isToday).toBe(true);
    expect(week.days[0]?.date).toBe(isoDaysAgo(6));
  });

  it('draws a day he did not log as absent, not as zero', async () => {
    const week = await getWeek(phil);

    expect(week.days.every((day) => day.proteinPct === null)).toBe(true);
    expect(week.avgProteinG).toBeNull();
    expect(week.loggedDays).toBe(0);
  });

  it('marks the days he lifted, with the template letter and set count', async () => {
    await finishedSession('B', 2);

    const day = (await getWeek(phil)).days.find((entry) => entry.date === isoDaysAgo(2));

    expect(day?.lifted).toBe(true);
    expect(day?.template).toBe('B');
    expect(day?.sets).toBe(1);
  });

  it('does not count a session he started and never finished', async () => {
    await createSession(phil, { template: 'A' });

    const week = await getWeek(phil);

    expect(week.strength.done).toBe(0);
    expect(week.days.at(-1)?.lifted).toBe(false);
  });

  it('counts strength sessions against the weekly target of three', async () => {
    await finishedSession('A', 5);
    await finishedSession('B', 3);

    const week = await getWeek(phil);

    expect(week.strength).toEqual({ done: 2, target: 3 });
  });

  it('leaves a session older than the strip out of the tally', async () => {
    await finishedSession('A', 9);

    expect((await getWeek(phil)).strength.done).toBe(0);
  });

  it('carries the weigh-ins through', async () => {
    await logWeight(phil, { measuredOn: isoDaysAgo(1), weightKg: 99 });
    await logWeight(phil, { measuredOn: isoDaysAgo(0), weightKg: 98.8 });

    const week = await getWeek(phil);

    expect(week.weighIns).toEqual({ done: 2, target: 7 });
    expect(week.days.at(-1)?.weightKg).toBe(98.8);
  });

  it('reports protein as a percentage of his target', async () => {
    await logMeal(phil, { slot: 'breakfast', description: 'Skyr', proteinG: 95, kcal: 520 });

    const today = (await getWeek(phil)).days.at(-1);

    expect(today?.proteinG).toBe(95);
    expect(today?.kcal).toBe(520);
    expect(today?.proteinPct).toBe(50);
  });

  it('averages protein over the days he logged, not over seven', async () => {
    await logMeal(phil, {
      slot: 'dinner',
      description: 'one',
      proteinG: 200,
      eatenAt: daysAgo(2),
    });
    await logMeal(phil, { slot: 'dinner', description: 'two', proteinG: 100 });

    const week = await getWeek(phil);

    expect(week.loggedDays).toBe(2);
    expect(week.avgProteinG).toBe(150);
  });

  it('labels the weekdays in German, two letters', async () => {
    const week = await getWeek(phil);

    for (const day of week.days) {
      expect(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']).toContain(day.weekday);
    }
  });
});

describe('getToday', () => {
  it('answers the whole screen in one round trip', async () => {
    const today = await getToday(phil);

    expect(today.date).toBe(isoDaysAgo(0));
    expect(today.profile.name).toBe('Phil');
    expect(today.context?.name).toBe('Home');
    expect(today.plan.template).toBe('A');
    expect(today.openSession).toBeNull();
    expect(today.completedToday).toEqual([]);
    expect(today.coach).toBeNull();
  });

  it('reports macros remaining against his targets', async () => {
    await logMeal(phil, { slot: 'breakfast', description: 'Skyr', kcal: 520, proteinG: 55, fatG: 6 });

    const today = await getToday(phil);

    expect(today.macros.consumed.proteinG).toBe(55);
    expect(today.macros.remaining.proteinG).toBe(190 - 55);
    expect(today.macros.remaining.kcal).toBe(2300 - 520);
    expect(today.macros.meals).toHaveLength(1);
  });

  it('shows the session in progress and plans around it', async () => {
    const open = await createSession(phil, { template: 'C' });

    const today = await getToday(phil);

    expect(today.openSession?.id).toBe(open.id);
    expect(today.plan.template).toBe('C');
  });

  it('lists a finished session so the screen stops offering a workout he has done', async () => {
    const session = await finishedSession('A', 0);

    const today = await getToday(phil);

    expect(today.completedToday.map((entry) => entry.id)).toEqual([session.id]);
    expect(today.openSession).toBeNull();
  });

  it('agrees with the week strip about how many sessions he has finished', async () => {
    await finishedSession('A', 4);
    await finishedSession('B', 1);

    const [today, week] = await Promise.all([getToday(phil), getWeek(phil)]);

    expect(today.week.strengthSessions.done).toBe(week.strength.done);
    expect(today.week.strengthSessions.target).toBe(3);
  });
});
