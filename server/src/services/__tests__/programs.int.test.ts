/**
 * The programme catalogue.
 *
 * Three full-body days were hardcoded, because there was one athlete and that
 * was his programme. The first test here is the one that matters most: his day
 * A is still exactly his day A. Everything else could be right and, if that one
 * is wrong, months of progression are reading from a movement he never did.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import {
  anotherAthlete,
  daysAgo,
  exerciseIdByName,
  phil,
  resetData,
  resetProfile,
} from '../../test/helpers';
import { completeOnboarding } from '../onboarding';
import { getProfile } from '../profile';
import { currentProgram, listPrograms, programBySlug, setProgram, slotsFor } from '../programs';
import { createSession } from '../sessions';
import { planFor, prescribeExercise, upcomingTemplate } from '../workouts';
import { pool } from '../../db';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await pool.query(
    `update profile set program_id = (select id from programs where slug = 'full_body_3')
     where user_id = 1`,
  );
  // Places are edited by some tests here; put Home back the way it is seeded.
  await pool.query(
    `update contexts
     set equipment = '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}'
     where user_id = 1 and name = 'Home'`,
  );
  sam = await anotherAthlete();
});

describe('the catalogue', () => {
  it('offers three programmes, shared by everybody', async () => {
    const mine = await listPrograms(phil);
    const hers = await listPrograms(sam);

    expect(mine.map((program) => program.slug)).toEqual([
      'full_body_3',
      'push_pull_legs',
      'upper_lower_4',
    ]);
    expect(hers.map((program) => program.slug)).toEqual(mine.map((program) => program.slug));
  });

  it('carries the days in rotation order', async () => {
    const fullBody = (await listPrograms(phil)).find((p) => p.slug === 'full_body_3')!;

    expect(fullBody.days.map((day) => day.code)).toEqual(['A', 'B', 'C']);
    expect(fullBody.days[0]?.name).toBe('Full body A');
  });

  it('names the days of a programme that is not lettered', async () => {
    const ppl = (await listPrograms(phil)).find((p) => p.slug === 'push_pull_legs')!;

    expect(ppl.days.map((day) => day.code)).toEqual(['Push', 'Pull', 'Legs']);
  });
});

describe('Phil\'s programme is unchanged', () => {
  it('still has him on full body', async () => {
    expect((await currentProgram(phil)).slug).toBe('full_body_3');
  });

  it('defines day A exactly as the hardcoded template did', async () => {
    const program = await currentProgram(phil);

    const slots = await slotsFor(phil, program.id, 'A');

    expect(slots.map((slot) => slot.exerciseName)).toEqual([
      'Back Squat',
      'Chest Press Machine',
      'Lat Pulldown',
      'Seated Leg Curl',
      'Seated Cable Row',
      'Lateral Raise',
    ]);
    expect(slots.map((slot) => slot.sets)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(slots.map((slot) => slot.incrementKg)).toEqual([2.5, 2.5, 2.5, 2.5, 2.5, 1.25]);
    expect(slots.map((slot) => slot.restSeconds)).toEqual([180, 150, 150, 90, 120, 60]);
    expect(slots.every((slot) => slot.range.min === 6 && slot.range.max === 12)).toBe(true);
  });

  it('prescribes it in the same order, ramp-in and all', async () => {
    const plan = await planFor(phil, 'A');

    expect(plan.exercises.map((exercise) => exercise.name)).toEqual([
      'Back Squat',
      'Chest Press Machine',
      'Lat Pulldown',
      'Seated Leg Curl',
      'Seated Cable Row',
      'Lateral Raise',
    ]);
    // No history, so the fortnight's ramp-in caps every movement at two
    // working sets — the programme says three, and the gate above it says two.
    expect(plan.rampIn.active).toBe(true);
    expect(plan.exercises.every((exercise) => exercise.sets === 2)).toBe(true);
  });

  it('rotates A → B → C → A', async () => {
    expect(await upcomingTemplate(phil)).toBe('A');

    await createSession(phil, { template: 'A', performedAt: daysAgo(3) });
    expect(await upcomingTemplate(phil)).toBe('B');

    await createSession(phil, { template: 'C', performedAt: daysAgo(1) });
    expect(await upcomingTemplate(phil)).toBe('A');
  });
});

describe('the plan says what day it is', () => {
  it('carries the day name and the programme name', async () => {
    const plan = await planFor(phil, 'B');

    expect(plan.template).toBe('B');
    expect(plan.dayName).toBe('Full body B');
    expect(plan.programName).toBe('Full body');
  });

  it('404s a day the programme does not have', async () => {
    await expect(planFor(phil, 'U1')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('switching programmes', () => {
  it('changes the days and the movements', async () => {
    const upperLower = (await listPrograms(phil)).find((p) => p.slug === 'upper_lower_4')!;

    await setProgram(phil, upperLower.id);

    expect((await currentProgram(phil)).slug).toBe('upper_lower_4');
    expect(await upcomingTemplate(phil)).toBe('U1');
    expect((await planFor(phil, 'L1')).exercises.map((e) => e.name)).toEqual([
      'Back Squat',
      'Romanian Deadlift',
      'Seated Leg Curl',
      'Leg Extension',
    ]);
  });

  it('starts the new rotation at the top rather than guessing', async () => {
    await createSession(phil, { template: 'C', performedAt: daysAgo(1) });
    const ppl = (await listPrograms(phil)).find((p) => p.slug === 'push_pull_legs')!;

    await setProgram(phil, ppl.id);

    // "What follows C in push/pull/legs" has no honest answer.
    expect(await upcomingTemplate(phil)).toBe('Push');
  });

  it('leaves history alone: a session keeps the day it was logged against', async () => {
    const session = await createSession(phil, { template: 'C', performedAt: daysAgo(1) });
    const ppl = (await listPrograms(phil)).find((p) => p.slug === 'push_pull_legs')!;

    await setProgram(phil, ppl.id);

    const { rows } = await pool.query('select template from sessions where id = $1', [session.id]);
    expect(rows[0].template).toBe('C');
  });

  it('404s a programme that is not in the catalogue', async () => {
    await expect(setProgram(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('is per athlete: switching his does not move hers', async () => {
    const ppl = (await listPrograms(phil)).find((p) => p.slug === 'push_pull_legs')!;

    await setProgram(phil, ppl.id);

    expect((await currentProgram(phil)).slug).toBe('push_pull_legs');
    expect((await currentProgram(sam)).slug).toBe('full_body_3');
  });
});

describe('choosing one at signup', () => {
  const ANSWERS = {
    sex: 'female',
    birthYear: 1996,
    heightCm: 168,
    weightKg: 65,
    goal: 'lose',
  } as const;

  it('puts somebody training three times a week on full body', async () => {
    await completeOnboarding(sam, { ...ANSWERS, trainingDaysPerWeek: 3 });

    expect((await currentProgram(sam)).slug).toBe('full_body_3');
  });

  it('puts somebody training four times a week on upper/lower', async () => {
    // Four days is where three full-body sessions stop being the best use of
    // them.
    await completeOnboarding(sam, { ...ANSWERS, trainingDaysPerWeek: 4 });

    expect((await currentProgram(sam)).slug).toBe('upper_lower_4');
    expect((await getProfile(sam)).trainingDaysPerWeek).toBe(4);
  });
});

describe('what the place has', () => {
  it('offers every substitute when the place has not said', async () => {
    // Nobody inventories a commercial gym. Assuming the worst would empty the
    // swap list for the majority.
    const squat = (await planFor(phil, 'A')).exercises[0]!;

    expect(squat.substitutes.map((sub) => sub.name)).toContain('Hack Squat');
    expect(squat.substitutes.map((sub) => sub.name)).toContain('Walking Lunge');
  });

  it('drops what a hotel room does not have', async () => {
    await pool.query(
      `update contexts
       set equipment = equipment || '{"available": ["dumbbell", "bodyweight"]}'::jsonb
       where user_id = 1 and is_active`,
    );

    const squat = (await planFor(phil, 'A')).exercises[0]!;
    const names = squat.substitutes.map((sub) => sub.name);

    expect(names).not.toContain('Hack Squat');
    expect(names).not.toContain('Leg Press');
    // And still leaves him something he can actually do.
    expect(names).toContain('Walking Lunge');
    expect(names).toContain('Dumbbell Squat');
  });

  it('filters a single prescription the same way', async () => {
    await pool.query(
      `update contexts
       set equipment = equipment || '{"available": ["bodyweight"]}'::jsonb
       where user_id = 1 and is_active`,
    );

    const lat = await prescribeExercise(phil, await exerciseIdByName('Lat Pulldown'));

    expect(lat.substitutes.map((sub) => sub.name)).toEqual([]);
  });
});

describe('slots', () => {
  it('reads a day in the order it is performed', async () => {
    const ppl = (await programBySlug(pool, 'push_pull_legs'))!;

    const legs = await slotsFor(phil, ppl.id, 'Legs');

    expect(legs[0]?.exerciseName).toBe('Back Squat');
    expect(legs.at(-1)?.exerciseName).toBe('Leg Extension');
  });

  it('is empty for a day that does not exist, rather than throwing', async () => {
    const ppl = (await programBySlug(pool, 'push_pull_legs'))!;

    expect(await slotsFor(phil, ppl.id, 'Nope')).toEqual([]);
  });
});
