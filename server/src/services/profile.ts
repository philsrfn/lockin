import { type Queryable, pool } from '../db';
import type { MacroTargets } from '../domain/macros';

export type Profile = {
  heightCm: number;
  birthYear: number | null;
  goalWeightKg: number | null;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
};

export async function getProfile(db: Queryable = pool): Promise<Profile> {
  const { rows } = await db.query<{
    height_cm: number;
    birth_year: number | null;
    goal_weight_kg: number | null;
    calorie_target: number;
    protein_target_g: number;
    fat_floor_g: number;
  }>(
    `select height_cm, birth_year, goal_weight_kg, calorie_target, protein_target_g, fat_floor_g
     from profile where id = 1`,
  );

  const row = rows[0];
  if (!row) throw new Error('Profile row is missing — did the seed migration run?');

  return {
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
