import { type Queryable, pool } from '../db';
import type { MacroTargets } from '../domain/macros';
import { checkCalorieTarget, checkGoalWeight, checkProteinTarget } from '../domain/safety';
import { isValidTimeZone } from '../domain/time';
import { badRequest } from '../errors';

export type Profile = {
  name: string | null;
  /** IANA zone. Decides when his day starts, which is most of what "today" means. */
  timezone: string;
  heightCm: number;
  birthYear: number | null;
  goalWeightKg: number | null;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
};

export async function getProfile(db: Queryable = pool): Promise<Profile> {
  const { rows } = await db.query<{
    name: string | null;
    timezone: string;
    height_cm: number;
    birth_year: number | null;
    goal_weight_kg: number | null;
    calorie_target: number;
    protein_target_g: number;
    fat_floor_g: number;
  }>(
    `select name, timezone, height_cm, birth_year, goal_weight_kg,
            calorie_target, protein_target_g, fat_floor_g
     from profile where id = 1`,
  );

  const row = rows[0];
  if (!row) throw new Error('Profile row is missing — did the seed migration run?');

  return {
    name: row.name,
    timezone: row.timezone,
    heightCm: row.height_cm,
    birthYear: row.birth_year,
    goalWeightKg: row.goal_weight_kg,
    calorieTarget: row.calorie_target,
    proteinTargetG: row.protein_target_g,
    fatFloorG: row.fat_floor_g,
  };
}

export const macroTargets = (profile: Profile): MacroTargets => ({
  kcal: profile.calorieTarget,
  proteinG: profile.proteinTargetG,
  fatFloorG: profile.fatFloorG,
});

/**
 * The only way targets change. Every field goes through a §7 floor first, and
 * a rejected value comes back with the reason so the trainer has to relay it
 * honestly rather than quietly obeying.
 */
export async function updateTargets(
  input: { calorieTarget?: number; proteinTargetG?: number; goalWeightKg?: number },
  db: Queryable = pool,
): Promise<{ profile: Profile; refusals: string[] }> {
  const current = await getProfile(db);
  const refusals: string[] = [];

  let calorieTarget = current.calorieTarget;
  if (input.calorieTarget !== undefined) {
    const verdict = checkCalorieTarget(input.calorieTarget);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    calorieTarget = verdict.value;
  }

  let proteinTargetG = current.proteinTargetG;
  if (input.proteinTargetG !== undefined) {
    const verdict = checkProteinTarget(input.proteinTargetG);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    proteinTargetG = verdict.value;
  }

  let goalWeightKg = current.goalWeightKg;
  if (input.goalWeightKg !== undefined) {
    const verdict = checkGoalWeight(input.goalWeightKg, current.heightCm);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    goalWeightKg = verdict.value;
  }

  await db.query(
    `update profile
     set calorie_target = $1, protein_target_g = $2, goal_weight_kg = $3, updated_at = now()
     where id = 1`,
    [calorieTarget, proteinTargetG, goalWeightKg],
  );

  return { profile: await getProfile(db), refusals };
}

/**
 * Moving him to another timezone. Validated here rather than trusted, because
 * a zone the runtime does not know would make every date in the app throw at
 * the moment it is read rather than at the moment it is set.
 */
export async function setTimezone(zone: string, db: Queryable = pool): Promise<Profile> {
  if (!isValidTimeZone(zone)) {
    throw badRequest(`${zone} is not a timezone this server knows`);
  }
  await db.query('update profile set timezone = $1, updated_at = now() where id = 1', [zone]);
  return getProfile(db);
}
