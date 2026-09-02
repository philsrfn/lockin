/**
 * Apple Health.
 *
 * Logging fatigue is the main reason fitness apps are deleted in week three,
 * and the antidote is not a better logger — it is not having to log. The two
 * properties everything here turns on: a sync is *partial*, because the phone
 * may have steps but not sleep yet; and a sync is *repeated*, because it runs
 * on every foreground with an overlapping window.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, isoDaysAgo, phil, resetData, resetProfile } from '../../test/helpers';
import { logWeight, summary } from '../bodyweight';
import { recentCardio } from '../cardio';
import { healthToday, recoverySignals, syncHealth } from '../health';
import { getToday } from '../today';
import { getWeek } from '../week';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

describe('days', () => {
  it('records steps, sleep and resting heart rate', async () => {
    const result = await syncHealth(phil, {
      days: [{ day: isoDaysAgo(0), steps: 11200, sleepMinutes: 445, restingHr: 54 }],
    });

    expect(result.days).toBe(1);
    expect(await healthToday(phil)).toMatchObject({
      steps: 11200,
      sleepMinutes: 445,
      restingHr: 54,
    });
  });

  it('does not erase last night\'s sleep with a sync that only has steps', async () => {
    // The phone syncs whatever HealthKit has answered for so far. A partial
    // picture must not overwrite a fuller one.
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), sleepMinutes: 445, restingHr: 54 }] });
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), steps: 11200 }] });

    expect(await healthToday(phil)).toMatchObject({
      steps: 11200,
      sleepMinutes: 445,
      restingHr: 54,
    });
  });

  it('updates a number that has grown during the day', async () => {
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), steps: 3000 }] });
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), steps: 11200 }] });

    expect((await healthToday(phil))?.steps).toBe(11200);
  });

  it('skips a day that is nonsense rather than failing the batch', async () => {
    const result = await syncHealth(phil, {
      days: [
        { day: isoDaysAgo(1), steps: 9000 },
        { day: 'not-a-date', steps: 9000 },
        { day: isoDaysAgo(0), steps: 900_000 },
        { day: isoDaysAgo(2), steps: 8000 },
      ],
    });

    // Two good days in, one bad date and one impossible step count dropped —
    // a fortnight of history must not fail because one day is odd.
    expect(result.days).toBe(2);
  });

  it('is per athlete', async () => {
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), steps: 11200 }] });

    expect(await healthToday(sam)).toBeNull();
  });
});

describe('workouts', () => {
  const RUN = {
    externalId: 'healthkit-uuid-1',
    startedAt: new Date().toISOString(),
    minutes: 38,
    kind: 'zone2' as const,
    description: 'Outdoor run',
    distanceKm: 6.4,
    avgHr: 141,
  };

  it('imports one as a cardio session', async () => {
    const result = await syncHealth(phil, { workouts: [RUN] });

    expect(result.workouts).toEqual({ imported: 1, alreadyHad: 0 });
    const sessions = await recentCardio(phil);
    expect(sessions[0]).toMatchObject({ kind: 'zone2', minutes: 38, distanceKm: 6.4 });
  });

  it('does not count the same run twice when the window overlaps', async () => {
    await syncHealth(phil, { workouts: [RUN] });
    const again = await syncHealth(phil, { workouts: [RUN] });

    expect(again.workouts).toEqual({ imported: 0, alreadyHad: 1 });
    expect(await recentCardio(phil)).toHaveLength(1);
  });

  it('counts towards the week like any other session', async () => {
    await syncHealth(phil, { workouts: [RUN] });

    expect((await getWeek(phil)).cardio.done).toBe(1);
  });

  it('keeps two athletes\' identical uuids apart', async () => {
    // HealthKit uuids are unique per device, not per person — the dedupe key
    // has to be scoped or one athlete's sync would swallow another's.
    await syncHealth(phil, { workouts: [RUN] });
    const hers = await syncHealth(sam, { workouts: [RUN] });

    expect(hers.workouts.imported).toBe(1);
  });
});

describe('weight from a scale', () => {
  it('fills a day he did not weigh in', async () => {
    await syncHealth(phil, { weights: [{ measuredOn: isoDaysAgo(0), weightKg: 94.2 }] });

    expect((await summary(phil)).latest?.weightKg).toBe(94.2);
  });

  it('never overwrites a number he typed', async () => {
    await logWeight(phil, { weightKg: 93 });

    const result = await syncHealth(phil, {
      weights: [{ measuredOn: isoDaysAgo(0), weightKg: 94.2 }],
    });

    expect(result.weights).toEqual({ imported: 0, keptHisOwn: 1 });
    expect((await summary(phil)).latest?.weightKg).toBe(93);
  });

  it('does update its own earlier import', async () => {
    await syncHealth(phil, { weights: [{ measuredOn: isoDaysAgo(0), weightKg: 94.2 }] });
    await syncHealth(phil, { weights: [{ measuredOn: isoDaysAgo(0), weightKg: 94.0 }] });

    expect((await summary(phil)).latest?.weightKg).toBe(94);
  });

  it('skips a slipped decimal point', async () => {
    const result = await syncHealth(phil, {
      weights: [{ measuredOn: isoDaysAgo(0), weightKg: 9.42 }],
    });

    expect(result.weights.imported).toBe(0);
    expect((await summary(phil)).latest).toBeNull();
  });
});

describe('the week', () => {
  it('averages steps over the days it knows, not over seven', async () => {
    // A phone that synced on Tuesday must not drag the week down with five
    // zeroes it has no opinion about.
    await syncHealth(phil, {
      days: [
        { day: isoDaysAgo(0), steps: 12000 },
        { day: isoDaysAgo(1), steps: 8000 },
      ],
    });

    const week = await getWeek(phil);

    expect(week.steps).toMatchObject({ average: 10000, daysKnown: 2 });
    expect(week.steps.target).toBe(9500);
  });

  it('says it does not know rather than saying zero', async () => {
    const week = await getWeek(phil);

    expect(week.steps.average).toBeNull();
    expect(week.days.every((day) => day.steps === null)).toBe(true);
  });

  it('reaches Today', async () => {
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), steps: 12000, restingHr: 52 }] });

    const today = await getToday(phil);

    expect(today.health).toMatchObject({ steps: 12000, restingHr: 52 });
    expect(today.week.steps.average).toBe(12000);
  });
});

describe('recovery signals', () => {
  it('is honest about knowing nothing', async () => {
    expect(await recoverySignals(phil)).toEqual({
      avgSteps: null,
      daysWithSteps: 0,
      lastNightSleepMinutes: null,
      restingHr: null,
      restingHrTrend: null,
    });
  });

  it('reports a resting heart rate that has drifted up over a block', async () => {
    // The signal that arrives before he feels it, which is the whole reason to
    // have it.
    const days = [];
    for (let ago = 0; ago < 28; ago += 1) {
      days.push({ day: isoDaysAgo(ago), restingHr: ago < 14 ? 58 : 52 });
    }
    await syncHealth(phil, { days });

    const signals = await recoverySignals(phil);

    expect(signals.restingHr).toBe(58);
    expect(signals.restingHrTrend).toBe(6);
  });

  it('says nothing about a trend it cannot see', async () => {
    await syncHealth(phil, { days: [{ day: isoDaysAgo(0), restingHr: 54 }] });

    const signals = await recoverySignals(phil);

    expect(signals.restingHr).toBe(54);
    expect(signals.restingHrTrend).toBeNull();
  });

  it('refuses a batch bigger than one sync should carry', async () => {
    const days = Array.from({ length: 401 }, (_, i) => ({ day: isoDaysAgo(i), steps: 1000 }));

    await expect(syncHealth(phil, { days })).rejects.toThrow('more history');
  });
});
