/**
 * Profile, contexts, rules, exercises — the state the trainer reads before it
 * says anything, and the state it is allowed to change.
 *
 * The §7 floors are unit-tested as pure functions. What matters here is that
 * the service actually puts them in the path: a tool call that tries to drop
 * him to 1200 kcal must come back with the old number and a refusal, not with
 * a quietly obeyed write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type Ctx, pool } from '../../db';
import {
  anotherAthlete,
  contextIdByName,
  exerciseIdByName,
  resetData,
  resetProfile,
  phil,
} from '../../test/helpers';
import {
  activateContext,
  activeContext,
  archiveContext,
  createContext,
  listContexts,
  updateContext,
} from '../contexts';
import { createExercise, exercisesByName, getExercise, listExercises } from '../exercises';
import { getProfile, macroTargets, updateTargets } from '../profile';
import { addRule, deactivateRule, listRules, updateRule } from '../rules';

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await pool.query('delete from contexts where user_id = 1 and id > 4');
  await pool.query(
    `update contexts set archived = false, is_active = (name = 'Home') where user_id = 1`,
  );
  await pool.query(
    `update contexts set name = 'Home', food_profile = '{"dinner": "moms_food_half_plus_protein"}',
       equipment = '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}'
     where user_id = 1 and id = 1`,
  );
  await pool.query('delete from rules where code is null');
  await pool.query('update rules set active = true');
});

describe('profile', () => {
  it('reads the seeded athlete', async () => {
    const profile = await getProfile(phil);

    expect(profile).toMatchObject({
      name: 'Phil',
      heightCm: 191,
      goalWeightKg: 80,
      calorieTarget: 2300,
      proteinTargetG: 190,
      fatFloorG: 70,
    });
  });

  it('exposes macro targets in the shape the remaining-macros maths wants', async () => {
    expect(macroTargets(await getProfile(phil))).toEqual({
      kcal: 2300,
      proteinG: 190,
      fatFloorG: 70,
    });
  });

  it('accepts a change that clears the floors', async () => {
    const result = await updateTargets(phil, { calorieTarget: 2100 });

    expect(result.refusals).toEqual([]);
    expect(result.profile.calorieTarget).toBe(2100);
  });

  it('refuses a calorie target under the floor and says so', async () => {
    const result = await updateTargets(phil, { calorieTarget: 1200 });

    expect(result.profile.calorieTarget).toBe(1800);
    expect(result.refusals.join(' ')).toContain('1800');
  });

  it('refuses a protein target under the floor', async () => {
    const result = await updateTargets(phil, { proteinTargetG: 100 });

    expect(result.profile.proteinTargetG).toBe(160);
    expect(result.refusals).toHaveLength(1);
  });

  it('refuses a goal weight below a BMI of 20 for his height', async () => {
    const result = await updateTargets(phil, { goalWeightKg: 65 });

    // 20 × 1.91² = 72.96, rounded up to the next half kilo.
    expect(result.profile.goalWeightKg).toBeGreaterThanOrEqual(72.9);
    expect(result.refusals).toHaveLength(1);
  });

  it('leaves untouched fields alone', async () => {
    await updateTargets(phil, { calorieTarget: 2100 });

    const profile = await getProfile(phil);
    expect(profile.proteinTargetG).toBe(190);
    expect(profile.goalWeightKg).toBe(80);
  });

  it('collects every refusal in one call rather than stopping at the first', async () => {
    const result = await updateTargets(phil, {
      calorieTarget: 1000,
      proteinTargetG: 50,
      goalWeightKg: 60,
    });

    expect(result.refusals).toHaveLength(3);
  });
});

describe('contexts', () => {
  it('seeds four places with Home active', async () => {
    const contexts = await listContexts(phil);

    expect(contexts.map((context) => context.name)).toEqual([
      'Home',
      'City A',
      'City B',
      'City C',
    ]);
    expect((await activeContext(phil))?.name).toBe('Home');
  });

  it('carries the food profile that makes Home different', async () => {
    const home = (await listContexts(phil)).find((context) => context.name === 'Home');

    expect(home?.foodProfile).toEqual({ dinner: 'moms_food_half_plus_protein' });
  });

  it('switching city leaves exactly one active, never two and never none', async () => {
    const contexts = await activateContext(phil, await contextIdByName('City C'));

    expect(contexts.filter((context) => context.isActive).map((c) => c.name)).toEqual(['City C']);
  });

  it('404s on a city that does not exist, leaving the active one alone', async () => {
    await expect(activateContext(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
    expect((await activeContext(phil))?.name).toBe('Home');
  });
});

describe('places he trains', () => {
  it('adds one, inactive until he switches to it', async () => {
    const contexts = await createContext(phil, {
      name: 'Gym near work',
      equipment: { gym: true, notes: 'dumbbells to 40kg, no rack' },
    });

    const added = contexts.find((context) => context.name === 'Gym near work');
    expect(added?.isActive).toBe(false);
    expect(added?.equipment).toEqual({ gym: true, notes: 'dumbbells to 40kg, no rack' });
    expect((await activeContext(phil))?.name).toBe('Home');
  });

  it.each([
    ['a blank name', { name: '   ' }, 'A place needs a name'],
    ['a name nobody could read', { name: 'x'.repeat(61) }, 'at most 60'],
  ])('refuses %s', async (_label, input, message) => {
    await expect(createContext(phil, input)).rejects.toThrow(message);
  });

  it('refuses a name he already uses', async () => {
    await expect(createContext(phil, { name: 'City C' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('renames without dropping the keys it has never heard of', async () => {
    // The trainer reads foodProfile.dinner. A rename must not lose it.
    const before = (await listContexts(phil)).find((context) => context.name === 'Home')!;

    const after = await updateContext(phil, before.id, { name: 'City A (renamed)' });

    const renamed = after.find((context) => context.id === before.id);
    expect(renamed?.name).toBe('City A (renamed)');
    expect(renamed?.foodProfile).toEqual({ dinner: 'moms_food_half_plus_protein' });
  });

  it('merges equipment rather than replacing it', async () => {
    const home = (await listContexts(phil)).find((context) => context.name === 'Home')!;

    const after = await updateContext(phil, home.id, { equipment: { notes: 'squat rack now' } });

    expect(after.find((context) => context.id === home.id)?.equipment).toMatchObject({
      gym: true,
      notes: 'squat rack now',
    });
  });

  it('404s editing a place that is not there', async () => {
    await expect(updateContext(phil, 9999, { name: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('archives rather than deletes, so old sessions keep their city', async () => {
    const leipzig = await contextIdByName('City C');

    const after = await archiveContext(phil, leipzig);

    expect(after.some((context) => context.id === leipzig)).toBe(false);
    const { rows } = await pool.query('select archived from contexts where id = $1', [leipzig]);
    expect(rows[0].archived).toBe(true);
  });

  it('frees the name once a place is archived', async () => {
    await archiveContext(phil, await contextIdByName('City C'));

    const after = await createContext(phil, { name: 'City C' });
    expect(after.filter((context) => context.name === 'City C')).toHaveLength(1);
  });

  it('hands the active flag on rather than leaving nowhere to train', async () => {
    const home = await contextIdByName('Home');

    const after = await archiveContext(phil, home);

    expect(after.filter((context) => context.isActive)).toHaveLength(1);
    expect((await activeContext(phil))?.name).not.toBe('Home');
  });

  it('will not archive the only place he has', async () => {
    for (const name of ['City A', 'City B', 'City C']) {
      await archiveContext(phil, await contextIdByName(name));
    }

    await expect(archiveContext(phil, await contextIdByName('Home'))).rejects.toThrow(
      'only place',
    );
  });

  it('404s archiving one that is not there', async () => {
    await expect(archiveContext(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rules', () => {
  it('seeds the three tiers', async () => {
    const tiers = new Set((await listRules(phil)).map((rule) => rule.tier));

    expect([...tiers].sort()).toEqual(['hard', 'never', 'soft']);
  });

  it('gives the mechanically checkable rules a code', async () => {
    const skyr = (await listRules(phil)).find((rule) => rule.code === 'breakfast_skyr');

    expect(skyr?.tier).toBe('hard');
    expect(skyr?.text).toContain('Skyr');
  });

  it('adds a rule and says plainly that it cannot be enforced', async () => {
    const result = await addRule(phil, { tier: 'soft', text: 'Prefer oat milk in coffee' });

    expect(result.rule.code).toBeNull();
    expect(result.enforceable).toBe(false);
  });

  it('scopes a rule to one city when asked', async () => {
    const result = await addRule(phil, { tier: 'soft', text: 'Gym closes at 22:00', scope: 'City C' });

    expect(result.rule.scope).toBe('City C');
  });

  it.each([
    ['an unknown tier', { tier: 'medium' as 'soft' }, 'tier must be hard, soft or never'],
    ['blank text', { text: '   ' }, 'A rule needs text'],
  ])('rejects %s', async (_label, override, message) => {
    await expect(addRule(phil, { tier: 'soft', text: 'something', ...override })).rejects.toThrow(message);
  });

  it('deactivates rather than deletes', async () => {
    const added = await addRule(phil, { tier: 'soft', text: 'Prefer oat milk' });

    const after = await deactivateRule(phil, added.rule.id);

    expect(after.active).toBe(false);
    expect((await listRules(phil)).some((rule) => rule.id === added.rule.id)).toBe(true);
  });

  it('404s deactivating a rule that is not there', async () => {
    await expect(deactivateRule(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('edits wording without restating the rest', async () => {
    const added = await addRule(phil, { tier: 'soft', text: 'Prefer oat milk', scope: 'City C' });

    const updated = await updateRule(phil, added.rule.id, { text: 'Prefer oat milk in coffee' });

    expect(updated.text).toBe('Prefer oat milk in coffee');
    expect(updated.scope).toBe('City C');
    expect(updated.tier).toBe('soft');
  });

  it('refuses to downgrade the tier of a rule that is enforced in code', async () => {
    const enforced = (await listRules(phil)).find((rule) => rule.code === 'min_daily_protein');

    await expect(updateRule(phil, enforced!.id, { tier: 'soft' })).rejects.toThrow(
      'enforced in code',
    );
  });

  it('still lets an enforced rule be reworded or turned off', async () => {
    const enforced = (await listRules(phil)).find((rule) => rule.code === 'min_daily_protein');

    const reworded = await updateRule(phil, enforced!.id, { text: 'Never plan a day under 160g protein' });
    expect(reworded.text).toBe('Never plan a day under 160g protein');

    expect((await updateRule(phil, enforced!.id, { active: false })).active).toBe(false);
  });

  it('404s editing a rule that is not there', async () => {
    await expect(updateRule(phil, 9999, { text: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('exercises', () => {
  it('seeds a library with substitutes wired within each movement pattern', async () => {
    const all = await listExercises(phil);
    const squat = all.find((exercise) => exercise.name === 'Back Squat');

    expect(all.length).toBeGreaterThan(30);
    expect(squat?.pattern).toBe('squat');
    const substitutePatterns = squat!.substitutes.map(
      (id) => all.find((exercise) => exercise.id === id)?.pattern,
    );
    expect(new Set(substitutePatterns)).toEqual(new Set(['squat']));
  });

  /**
   * Migration 035 wired seventy-six more movements into the substitute chains
   * by name, in two passes, one of which appends. A typo in either lands a
   * press in a squat's alternatives, and the swap button is where somebody
   * finds out — mid-session, in a gym, looking for something they can
   * actually do.
   *
   * The rule is not quite "same pattern", and writing it that way is how this
   * test failed the first time it ran. `iso` is a catch-all rather than a
   * movement pattern, and the seed has always paired across it on purpose:
   * 002 offers a Romanian deadlift when the leg curl machine is taken, and
   * 016 offers a Nordic curl. Both are hamstrings, both are the right answer,
   * and neither shares a bucket with a leg curl because there is no bucket
   * for hamstrings. So: identical patterns, or one side is the catch-all.
   *
   * The `swap_exercise` tool is stricter and demands an exact match, which
   * means the model cannot offer those pairs and the button can. That is a
   * known asymmetry, not something this test is asserting away.
   */
  it('never offers a substitute from an unrelated movement pattern', async () => {
    const all = await listExercises(phil);
    const byId = new Map(all.map((exercise) => [exercise.id, exercise]));

    const crossed = all.flatMap((exercise) =>
      exercise.substitutes
        .map((id) => byId.get(id))
        .filter(
          (sub) =>
            sub &&
            sub.pattern !== exercise.pattern &&
            sub.pattern !== 'iso' &&
            exercise.pattern !== 'iso',
        )
        .map((sub) => `${exercise.name} -> ${sub!.name}`),
    );

    expect(crossed).toEqual([]);
  });

  /**
   * The holes 035 was written to close. Named individually rather than
   * counted, because "more than a hundred exercises" passes happily while the
   * app still cannot log a deadlift.
   */
  it('covers the movements somebody arriving from another app looks for first', async () => {
    const names = new Set((await listExercises(phil)).map((exercise) => exercise.name));

    for (const wanted of [
      'Conventional Deadlift',
      'Front Squat',
      'Incline Barbell Bench Press',
      'T-Bar Row',
      'Standing Calf Raise',
      'Hanging Leg Raise',
      'Preacher Curl',
      'Plank',
    ]) {
      expect(names, wanted).toContain(wanted);
    }
  });

  it('never lists an exercise as its own substitute', async () => {
    for (const exercise of await listExercises(phil)) {
      expect(exercise.substitutes).not.toContain(exercise.id);
    }
  });

  it('resolves every name the training templates reference', async () => {
    await expect(exercisesByName()).resolves.toBeInstanceOf(Map);
  });

  it('cannot lose an exercise a programme points at', async () => {
    // The programme used to reference exercises by name, and a startup check
    // caught a drift. Programmes are rows now: program_slots.exercise_id is a
    // foreign key, so the database refuses at migration time instead — which
    // is earlier and stricter than anything the app could do.
    const squat = await exerciseIdByName('Back Squat');

    await expect(pool.query('delete from exercises where id = $1', [squat])).rejects.toThrow();
  });

  it('404s on an exercise id that does not exist', async () => {
    await expect(getExercise(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * Movements somebody adds themselves (migration 035).
 *
 * `exercises` was the one table in the app that belonged to nobody, and these
 * are the tests that the half-owned version of it did not quietly become a
 * shared one: a movement Phil invents is his, Sam cannot see it, and neither
 * of them can log a set against the other's.
 */
describe('exercises somebody added themselves', () => {
  let sam: Ctx;

  beforeEach(async () => {
    sam = await anotherAthlete();
  });

  it('appears in their library and nowhere else', async () => {
    const made = await createExercise(phil, {
      name: 'Reverse Hyper',
      pattern: 'hinge',
      equipment: ['machine'],
    });

    expect(made.custom).toBe(true);
    expect(made.substitutes).toEqual([]);

    const mine = await listExercises(phil);
    expect(mine.map((exercise) => exercise.name)).toContain('Reverse Hyper');
    // The catalogue leads; what somebody invented sits under it.
    expect(mine.filter((exercise) => exercise.custom).map((e) => e.name)).toEqual(['Reverse Hyper']);

    const theirs = await listExercises(sam);
    expect(theirs.map((exercise) => exercise.name)).not.toContain('Reverse Hyper');
    await expect(getExercise(sam, made.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a name the catalogue already has, whatever the casing', async () => {
    await expect(createExercise(phil, { name: 'back squat', pattern: 'squat' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('refuses a second copy of one they made', async () => {
    await createExercise(phil, { name: 'Belt Squat', pattern: 'squat' });

    await expect(createExercise(phil, { name: '  belt   squat ', pattern: 'squat' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('lets two athletes invent the same movement independently', async () => {
    await createExercise(phil, { name: 'Club Row', pattern: 'h_pull' });
    const hers = await createExercise(sam, { name: 'Club Row', pattern: 'h_pull' });

    expect(hers.custom).toBe(true);
    expect(hers.name).toBe('Club Row');
  });

  it('takes a pattern the swap logic understands, and nothing else', async () => {
    await expect(
      createExercise(phil, { name: 'Something', pattern: 'cardio' }),
    ).rejects.toThrow();
  });
});
