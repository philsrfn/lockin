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
import { planFor, prescribeExercise, templateForToday, upcomingTemplate } from '../workouts';
import { getToday } from '../today';
import { recordSet } from '../sets';
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

describe('switching programmes with a session still open', () => {
  /**
   * The bug this exists for: Phil switched from Full body to PPL with an
   * unfinished "B" open. Today asked PPL for a day called B, PPL has none, and
   * the 404 took the entire payload with it — home screen, trainer context and
   * every screen depending on either. The app stopped, and switching back was
   * the only way out.
   */
  async function switchTo(slug: string) {
    const programs = await listPrograms(phil);
    const target = programs.find((program) => program.slug === slug);
    if (!target) throw new Error(`No seeded programme ${slug}`);
    return setProgram(phil, target.id);
  }

  it('does not ask the new programme for a day it has never had', async () => {
    const open = await createSession(phil, { template: 'B' });
    expect(open.template).toBe('B');

    const ppl = await switchTo('push_pull_legs');
    expect(ppl.days.some((day) => day.code === 'B')).toBe(false);

    const template = await templateForToday(phil, 'B');

    expect(ppl.days.map((day) => day.code)).toContain(template);
  });

  it('keeps Today answering at all', async () => {
    await createSession(phil, { template: 'B' });
    await switchTo('push_pull_legs');

    const today = await getToday(phil);

    expect(today.plan.exercises.length).toBeGreaterThan(0);
    expect(today.profile.name).toBe('Phil');
  });

  it('still follows the open session when it belongs to this programme', async () => {
    // The fallback must not throw away a session he is actually mid-way
    // through: that would re-prescribe the wrong day between sets.
    const programs = await listPrograms(phil);
    const current = programs.find((program) => program.slug === 'full_body_3')!;
    await setProgram(phil, current.id);

    const code = current.days[1]!.code;
    const template = await templateForToday(phil, code);

    expect(template).toBe(code);
  });

  it('leaves the sets already logged on that session alone', async () => {
    const open = await createSession(phil, { template: 'B' });
    await recordSet(phil, {
      sessionId: open.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
      rir: 2,
    });

    await switchTo('push_pull_legs');

    const { rows } = await pool.query('select count(*)::int as n from sets where session_id = $1', [
      open.id,
    ]);
    expect(rows[0].n).toBe(1);
  });
});

describe('the coach note can store any day the catalogue offers', () => {
  /**
   * coach_notes.template was checked against ('A','B','C') in migration 004,
   * when three full-body days were the whole world. The catalogue has offered
   * Push/Pull/Legs and Upper/Lower since migration 015 and the constraint
   * never moved, so writing the note for anybody on either programme threw —
   * which is a 500 on the Today screen's coach card, and a silently missing
   * note on every morning check-in.
   *
   * The day codes are validated where they belong: the model is handed the
   * current programme's codes as an enum, and sanitise() checks its answer
   * against the same list. A second, staler copy of that list in a check
   * constraint could only ever be wrong.
   */
  it('accepts every day code in the catalogue, not just the first programme\'s', async () => {
    const { rows } = await pool.query<{ code: string }>(
      'select distinct code from program_days order by code',
    );
    const codes = rows.map((row) => row.code);
    expect(codes.length).toBeGreaterThan(3);

    for (const [index, code] of codes.entries()) {
      await expect(
        pool.query(
          `insert into coach_notes (user_id, for_date, session_type, template, headline, body)
           values ($1, date '2026-01-01' + $2::int, 'strength', $3, 'x', 'y')`,
          [phil.userId, index, code],
        ),
      ).resolves.toBeDefined();
    }
  });
});

describe('the plan carries every day, not only the next one', () => {
  /**
   * The rotation proposes; it does not get to insist. Somebody whose friends
   * are doing Pull today will train Pull either way — the only question the
   * app answers is whether it is logged as Pull or as whatever came next.
   */
  it('lists the programme\'s days in rotation order, marking the suggestion', async () => {
    const plan = await planFor(phil, 'A');

    expect(plan.days.map((day) => day.code)).toEqual(['A', 'B', 'C']);
    expect(plan.days.filter((day) => day.isToday).map((day) => day.code)).toEqual(['A']);
  });

  it('marks whichever day is being planned, not a fixed one', async () => {
    const plan = await planFor(phil, 'C');

    expect(plan.days.find((day) => day.isToday)?.code).toBe('C');
  });

  it('follows the athlete onto another programme', async () => {
    await setProgram(phil, (await programBySlug(pool, 'push_pull_legs'))!.id);

    const plan = await planFor(phil, 'Pull');

    expect(plan.days.map((day) => day.code)).toEqual(['Push', 'Pull', 'Legs']);
    expect(plan.days.find((day) => day.isToday)?.code).toBe('Pull');
  });
});
