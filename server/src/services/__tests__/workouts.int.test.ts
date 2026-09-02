/**
 * Planning a session: what the logger opens pre-populated with.
 *
 * The double-progression arithmetic itself is covered by the domain tests. What
 * is tested here is the wiring — that the right history reaches it, that a
 * session in progress does not feed its own sets back into its own prescription,
 * and that the ramp-in and joint-pain gates are actually applied rather than
 * merely computed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { daysAgo, exerciseIdByName, resetData } from '../../test/helpers';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';
import { planFor, prescribeExercise, progress, upcomingTemplate } from '../workouts';

beforeEach(resetData);

/** A finished session, the way the logger would have written it. */
async function loggedSession(options: {
  template: 'A' | 'B' | 'C';
  daysBack: number;
  exercise: string;
  sets: { weightKg: number; reps: number; rir?: number }[];
  rpe?: number;
  jointPain?: boolean;
}) {
  const session = await createSession({
    template: options.template,
    performedAt: daysAgo(options.daysBack),
  });
  const exerciseId = await exerciseIdByName(options.exercise);

  for (const [index, set] of options.sets.entries()) {
    await recordSet({
      sessionId: session.id,
      exerciseId,
      setIndex: index + 1,
      weightKg: set.weightKg,
      reps: set.reps,
      rir: set.rir ?? null,
    });
  }

  await finishSession(session.id, {
    rpe: options.rpe ?? 8,
    jointPain: options.jointPain ?? false,
  });
  return session;
}

const NOW = new Date();
const LONG_AGO = new Date(Date.now() - 400 * 86_400_000);

describe('upcomingTemplate', () => {
  it('starts at A when he has never trained', async () => {
    expect(await upcomingTemplate()).toBe('A');
  });

  it('rotates off the last session, not off the weekday', async () => {
    await createSession({ template: 'A', performedAt: daysAgo(2) });

    expect(await upcomingTemplate()).toBe('B');
  });

  it('wraps C back round to A', async () => {
    await createSession({ template: 'A', performedAt: daysAgo(6) });
    await createSession({ template: 'C', performedAt: daysAgo(2) });

    expect(await upcomingTemplate()).toBe('A');
  });
});

describe('planFor', () => {
  it('lays out the whole template, with substitutes for each movement', async () => {
    const plan = await planFor('A');

    expect(plan.template).toBe('A');
    expect(plan.exercises.map((exercise) => exercise.name)).toEqual([
      'Back Squat',
      'Chest Press Machine',
      'Lat Pulldown',
      'Seated Leg Curl',
      'Seated Cable Row',
      'Lateral Raise',
    ]);
    expect(plan.exercises[0]?.substitutes.length).toBeGreaterThan(0);
  });

  it('leaves the weight blank the first time — he picks it, we record it', async () => {
    const plan = await planFor('A');
    const squat = plan.exercises[0];

    expect(squat?.weightKg).toBeNull();
    expect(squat?.reason).toBe('first_time');
    expect(squat?.last).toBeNull();
  });

  it('carries last session\'s numbers through as the target line', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 3,
      exercise: 'Back Squat',
      sets: [
        { weightKg: 87.5, reps: 8 },
        { weightKg: 87.5, reps: 8 },
        { weightKg: 87.5, reps: 8 },
      ],
    });

    const squat = (await planFor('A', { now: NOW })).exercises[0];

    expect(squat?.last?.sets).toHaveLength(3);
    expect(squat?.weightKg).toBe(87.5);
    expect(squat?.reason).toBe('increase_reps');
  });

  it('caps the ramp-in at two working sets in the first fortnight', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 2,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }],
    });

    const plan = await planFor('A', { now: NOW });

    expect(plan.rampIn.active).toBe(true);
    expect(plan.exercises.every((exercise) => exercise.sets <= 2)).toBe(true);
  });

  it('lifts the cap once he is past the ramp-in window', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 400,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }],
    });

    const plan = await planFor('A', { now: NOW });

    expect(plan.rampIn.active).toBe(false);
    expect(plan.exercises[0]?.sets).toBe(3);
  });

  it('holds load and flags a doctor after two consecutive joint-pain sessions', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 380,
      exercise: 'Back Squat',
      sets: [{ weightKg: 100, reps: 12 }, { weightKg: 100, reps: 12 }, { weightKg: 100, reps: 12 }],
      jointPain: true,
    });
    await loggedSession({
      template: 'A',
      daysBack: 377,
      exercise: 'Back Squat',
      sets: [{ weightKg: 100, reps: 12 }, { weightKg: 100, reps: 12 }, { weightKg: 100, reps: 12 }],
      jointPain: true,
    });

    const plan = await planFor('A', { now: LONG_AGO });

    expect(plan.jointPain.recommendDoctor).toBe(true);
    // Every set was at the top of the range — without the gate this would be a
    // load increase.
    expect(plan.exercises[0]?.reason).toBe('joint_pain');
    expect(plan.exercises[0]?.weightKg).toBeLessThan(100);
  });

  it('excludes the session in progress from its own history', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 400,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }],
    });

    const open = await createSession({ template: 'A' });
    await recordSet({
      sessionId: open.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 80,
      reps: 12,
    });

    const withOpen = await planFor('A', { excludeSessionId: open.id, now: NOW });
    const withoutExclusion = await planFor('A', { now: NOW });

    // Mid-session, the target must still be what the *last* session earned.
    expect(withOpen.exercises[0]?.last?.sets).toHaveLength(3);
    expect(withoutExclusion.exercises[0]?.last?.sets).toHaveLength(1);
  });

  it('ignores logged warm-up rows with zero reps', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 400,
      exercise: 'Back Squat',
      sets: [{ weightKg: 60, reps: 0 }, { weightKg: 90, reps: 8 }],
    });

    const squat = (await planFor('A', { now: NOW })).exercises[0];

    expect(squat?.last?.sets.map((set) => set.reps)).toEqual([8]);
  });
});

describe('prescribeExercise', () => {
  it('gives a swapped-in movement its own history, not a blank field', async () => {
    await loggedSession({
      template: 'C',
      daysBack: 400,
      exercise: 'Leg Press',
      sets: [{ weightKg: 160, reps: 8 }, { weightKg: 160, reps: 8 }, { weightKg: 160, reps: 8 }],
    });

    const legPress = await prescribeExercise(await exerciseIdByName('Leg Press'), { now: NOW });

    expect(legPress.weightKg).toBe(160);
    expect(legPress.last?.sets).toHaveLength(3);
  });

  it('uses pattern defaults for a movement the templates never name', async () => {
    const curl = await prescribeExercise(await exerciseIdByName('Barbell Curl'));

    expect(curl.incrementKg).toBe(1.25);
    expect(curl.restSeconds).toBe(60);
  });

  it('404s on an exercise that is not in the library', async () => {
    await expect(prescribeExercise(9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('progress', () => {
  it('is empty rather than zeroed before he has trained', async () => {
    expect(await progress()).toEqual({
      sessionCount: 0,
      setCount: 0,
      totalVolumeKg: 0,
      exercises: [],
    });
  });

  it('counts sessions, sets and total volume', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 3,
      exercise: 'Back Squat',
      sets: [{ weightKg: 90, reps: 8 }, { weightKg: 90, reps: 8 }],
    });

    const result = await progress();

    expect(result.sessionCount).toBe(1);
    expect(result.setCount).toBe(2);
    expect(result.totalVolumeKg).toBe(2 * 90 * 8);
  });

  it('keeps one point per exercise per day — the best set of that session', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 3,
      exercise: 'Back Squat',
      sets: [{ weightKg: 90, reps: 5 }, { weightKg: 90, reps: 10 }, { weightKg: 90, reps: 8 }],
    });

    const squat = (await progress()).exercises.find((entry) => entry.name === 'Back Squat');

    expect(squat?.points).toHaveLength(1);
    expect(squat?.points[0]?.reps).toBe(10);
  });

  it('uses Epley so a heavier triple does not beat a much harder set of eight', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 5,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }],
    });
    await loggedSession({
      template: 'A',
      daysBack: 2,
      exercise: 'Back Squat',
      sets: [{ weightKg: 90, reps: 3 }],
    });

    const points = (await progress()).exercises[0]?.points ?? [];

    // 80 × (1 + 8/30) = 101.3 against 90 × (1 + 3/30) = 99.
    expect(points[0]?.estimated1rm).toBeCloseTo(101.3, 1);
    expect(points[1]?.estimated1rm).toBeCloseTo(99, 1);
  });

  it('orders points oldest first and exercises most-trained first', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 9,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }],
    });
    await loggedSession({
      template: 'A',
      daysBack: 4,
      exercise: 'Back Squat',
      sets: [{ weightKg: 85, reps: 8 }],
    });
    await loggedSession({
      template: 'A',
      daysBack: 2,
      exercise: 'Lat Pulldown',
      sets: [{ weightKg: 60, reps: 10 }],
    });

    const result = await progress();

    expect(result.exercises[0]?.name).toBe('Back Squat');
    expect(result.exercises[0]?.points.map((point) => point.weightKg)).toEqual([80, 85]);
  });

  it('windows by days, so an old cycle does not sit in the chart forever', async () => {
    await loggedSession({
      template: 'A',
      daysBack: 200,
      exercise: 'Back Squat',
      sets: [{ weightKg: 80, reps: 8 }],
    });

    expect((await progress(90)).exercises).toEqual([]);
    expect((await progress(365)).exercises).toHaveLength(1);
  });
});
