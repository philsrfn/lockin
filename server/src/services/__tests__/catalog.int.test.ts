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
import { pool } from '../../db';
import { contextIdByName, resetData, resetProfile } from '../../test/helpers';
import { activateContext, activeContext, listContexts } from '../contexts';
import { exercisesByName, getExercise, listExercises } from '../exercises';
import { getProfile, macroTargets, updateTargets } from '../profile';
import { addRule, deactivateRule, listRules, updateRule } from '../rules';

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await pool.query(`update contexts set is_active = (name = 'Home')`);
  await pool.query('delete from rules where code is null');
  await pool.query('update rules set active = true');
});

describe('profile', () => {
  it('reads the seeded athlete', async () => {
    const profile = await getProfile();

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
    expect(macroTargets(await getProfile())).toEqual({
      kcal: 2300,
      proteinG: 190,
      fatFloorG: 70,
    });
  });

  it('accepts a change that clears the floors', async () => {
    const result = await updateTargets({ calorieTarget: 2100 });

    expect(result.refusals).toEqual([]);
    expect(result.profile.calorieTarget).toBe(2100);
  });

  it('refuses a calorie target under the floor and says so', async () => {
    const result = await updateTargets({ calorieTarget: 1200 });

    expect(result.profile.calorieTarget).toBe(1800);
    expect(result.refusals.join(' ')).toContain('1800');
  });

  it('refuses a protein target under the floor', async () => {
    const result = await updateTargets({ proteinTargetG: 100 });

    expect(result.profile.proteinTargetG).toBe(160);
    expect(result.refusals).toHaveLength(1);
  });

  it('refuses a goal weight below a BMI of 20 for his height', async () => {
    const result = await updateTargets({ goalWeightKg: 65 });

    // 20 × 1.91² = 72.96, rounded up to the next half kilo.
    expect(result.profile.goalWeightKg).toBeGreaterThanOrEqual(72.9);
    expect(result.refusals).toHaveLength(1);
  });

  it('leaves untouched fields alone', async () => {
    await updateTargets({ calorieTarget: 2100 });

    const profile = await getProfile();
    expect(profile.proteinTargetG).toBe(190);
    expect(profile.goalWeightKg).toBe(80);
  });

  it('collects every refusal in one call rather than stopping at the first', async () => {
    const result = await updateTargets({
      calorieTarget: 1000,
      proteinTargetG: 50,
      goalWeightKg: 60,
    });

    expect(result.refusals).toHaveLength(3);
  });
});

describe('contexts', () => {
  it('seeds the four cities with Home active', async () => {
    const contexts = await listContexts();

    expect(contexts.map((context) => context.name)).toEqual([
      'Home',
      'Münster',
      'Mannheim',
      'Leipzig',
    ]);
    expect((await activeContext())?.name).toBe('Home');
  });

  it('carries the food profile that makes Home different', async () => {
    const home = (await listContexts()).find((context) => context.name === 'Home');

    expect(home?.foodProfile).toEqual({ dinner: 'moms_food_half_plus_protein' });
  });

  it('switching city leaves exactly one active, never two and never none', async () => {
    const contexts = await activateContext(await contextIdByName('Leipzig'));

    expect(contexts.filter((context) => context.isActive).map((c) => c.name)).toEqual(['Leipzig']);
  });

  it('404s on a city that does not exist, leaving the active one alone', async () => {
    await expect(activateContext(9999)).rejects.toMatchObject({ statusCode: 404 });
    expect((await activeContext())?.name).toBe('Home');
  });
});

describe('rules', () => {
  it('seeds the three tiers', async () => {
    const tiers = new Set((await listRules()).map((rule) => rule.tier));

    expect([...tiers].sort()).toEqual(['hard', 'never', 'soft']);
  });

  it('gives the mechanically checkable rules a code', async () => {
    const skyr = (await listRules()).find((rule) => rule.code === 'breakfast_skyr');

    expect(skyr?.tier).toBe('hard');
    expect(skyr?.text).toContain('Skyr');
  });

  it('adds a rule and says plainly that it cannot be enforced', async () => {
    const result = await addRule({ tier: 'soft', text: 'Prefer oat milk in coffee' });

    expect(result.rule.code).toBeNull();
    expect(result.enforceable).toBe(false);
  });

  it('scopes a rule to one city when asked', async () => {
    const result = await addRule({ tier: 'soft', text: 'Gym closes at 22:00', scope: 'Leipzig' });

    expect(result.rule.scope).toBe('Leipzig');
  });

  it.each([
    ['an unknown tier', { tier: 'medium' as 'soft' }, 'tier must be hard, soft or never'],
    ['blank text', { text: '   ' }, 'A rule needs text'],
  ])('rejects %s', async (_label, override, message) => {
    await expect(addRule({ tier: 'soft', text: 'something', ...override })).rejects.toThrow(message);
  });

  it('deactivates rather than deletes', async () => {
    const added = await addRule({ tier: 'soft', text: 'Prefer oat milk' });

    const after = await deactivateRule(added.rule.id);

    expect(after.active).toBe(false);
    expect((await listRules()).some((rule) => rule.id === added.rule.id)).toBe(true);
  });

  it('404s deactivating a rule that is not there', async () => {
    await expect(deactivateRule(9999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('edits wording without restating the rest', async () => {
    const added = await addRule({ tier: 'soft', text: 'Prefer oat milk', scope: 'Leipzig' });

    const updated = await updateRule(added.rule.id, { text: 'Prefer oat milk in coffee' });

    expect(updated.text).toBe('Prefer oat milk in coffee');
    expect(updated.scope).toBe('Leipzig');
    expect(updated.tier).toBe('soft');
  });

  it('refuses to downgrade the tier of a rule that is enforced in code', async () => {
    const enforced = (await listRules()).find((rule) => rule.code === 'min_daily_protein');

    await expect(updateRule(enforced!.id, { tier: 'soft' })).rejects.toThrow(
      'enforced in code',
    );
  });

  it('still lets an enforced rule be reworded or turned off', async () => {
    const enforced = (await listRules()).find((rule) => rule.code === 'min_daily_protein');

    const reworded = await updateRule(enforced!.id, { text: 'Never plan a day under 160g protein' });
    expect(reworded.text).toBe('Never plan a day under 160g protein');

    expect((await updateRule(enforced!.id, { active: false })).active).toBe(false);
  });

  it('404s editing a rule that is not there', async () => {
    await expect(updateRule(9999, { text: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('exercises', () => {
  it('seeds a library with substitutes wired within each movement pattern', async () => {
    const all = await listExercises();
    const squat = all.find((exercise) => exercise.name === 'Back Squat');

    expect(all.length).toBeGreaterThan(30);
    expect(squat?.pattern).toBe('squat');
    const substitutePatterns = squat!.substitutes.map(
      (id) => all.find((exercise) => exercise.id === id)?.pattern,
    );
    expect(new Set(substitutePatterns)).toEqual(new Set(['squat']));
  });

  it('never lists an exercise as its own substitute', async () => {
    for (const exercise of await listExercises()) {
      expect(exercise.substitutes).not.toContain(exercise.id);
    }
  });

  it('resolves every name the training templates reference', async () => {
    await expect(exercisesByName()).resolves.toBeInstanceOf(Map);
  });

  it('fails loudly when a template name drifts out of the library', async () => {
    await pool.query(`update exercises set name = 'Back Squat (old)' where name = 'Back Squat'`);
    try {
      await expect(exercisesByName()).rejects.toThrow('Back Squat');
    } finally {
      await pool.query(`update exercises set name = 'Back Squat' where name = 'Back Squat (old)'`);
    }
  });

  it('404s on an exercise id that does not exist', async () => {
    await expect(getExercise(9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
