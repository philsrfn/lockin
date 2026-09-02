import type { Ctx } from '../db';
import type { MacroTargets } from '../domain/macros';
import { checkCalorieTarget, checkGoalWeight, checkProteinTarget } from '../domain/safety';
import {
  type ActivityLevel,
  type Goal,
  type Sex,
  ageFromBirthYear,
  maintenanceKcal,
} from '../domain/targets';
import { SUPPORT_NOTE, UNDERWEIGHT_BMI, bmi } from '../domain/screening';
import type { AthleteFacts } from '../domain/safety';
import { isValidTimeZone } from '../domain/time';
import { badRequest } from '../errors';

export type Profile = {
  name: string | null;
  /** IANA zone. Decides when his day starts, which is most of what "today" means. */
  timezone: string;
  /**
   * BCP 47 language tag, or null to follow the device. The athlete's choice,
   * not the phone's: a German speaker on an English handset still wants German.
   */
  locale: string | null;
  heightCm: number;
  birthYear: number | null;
  goalWeightKg: number | null;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
  sex: Sex | null;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
  trainingDaysPerWeek: number | null;
  /** The rate the targets were sized from, after clamping. Negative is loss. */
  weeklyRateKg: number | null;
  /**
   * False until the questionnaire is answered. The app routes to onboarding on
   * this rather than on a missing field, so adding a question later does not
   * send everyone back through it.
   */
  onboarded: boolean;
};

export async function getProfile(ctx: Ctx): Promise<Profile> {
  const { rows } = await ctx.db.query<{
    name: string | null;
    timezone: string;
    locale: string | null;
    height_cm: number;
    birth_year: number | null;
    goal_weight_kg: number | null;
    calorie_target: number;
    protein_target_g: number;
    fat_floor_g: number;
    sex: Sex | null;
    activity_level: ActivityLevel | null;
    goal: Goal | null;
    training_days_per_week: number | null;
    weekly_rate_kg: number | null;
    onboarded_at: Date | null;
  }>(
    `select name, timezone, locale, height_cm, birth_year, goal_weight_kg,
            calorie_target, protein_target_g, fat_floor_g,
            sex, activity_level, goal, training_days_per_week, weekly_rate_kg,
            onboarded_at
     from profile where user_id = $1`,
    [ctx.userId],
  );

  const row = rows[0];
  if (!row) throw new Error(`No profile for user ${ctx.userId} — was the user provisioned?`);

  return {
    name: row.name,
    timezone: row.timezone,
    locale: row.locale,
    heightCm: row.height_cm,
    birthYear: row.birth_year,
    goalWeightKg: row.goal_weight_kg,
    calorieTarget: row.calorie_target,
    proteinTargetG: row.protein_target_g,
    fatFloorG: row.fat_floor_g,
    sex: row.sex,
    activityLevel: row.activity_level,
    goal: row.goal,
    trainingDaysPerWeek: row.training_days_per_week,
    weeklyRateKg: row.weekly_rate_kg,
    onboarded: row.onboarded_at !== null,
  };
}

/**
 * What the §7 floors need to be about this athlete rather than about Phil.
 * Reads the latest weigh-in, because a floor derived from a weight recorded at
 * signup would drift wrong over a year of training.
 */
export type FullAthleteFacts = AthleteFacts & {
  activityLevel: ActivityLevel | null;
  trainingDaysPerWeek: number | null;
};

export async function athleteFacts(ctx: Ctx, profile?: Profile): Promise<FullAthleteFacts> {
  const current = profile ?? (await getProfile(ctx));
  const { rows } = await ctx.db.query<{ weight_kg: number }>(
    'select weight_kg from bodyweight where user_id = $1 order by measured_on desc limit 1',
    [ctx.userId],
  );

  return {
    sex: current.sex,
    heightCm: current.heightCm,
    weightKg: rows[0]?.weight_kg ?? null,
    ageYears: current.birthYear ? ageFromBirthYear(current.birthYear) : null,
    activityLevel: current.activityLevel,
    trainingDaysPerWeek: current.trainingDaysPerWeek,
  };
}

/**
 * A deficit is the wrong answer for somebody already under a healthy weight,
 * whatever the model was persuaded of. Their floor is maintenance, not their
 * resting rate — so the trainer cannot walk them down, and it has to say why.
 *
 * Returns null when the app does not know enough to judge, which is the same
 * position it was in before onboarding existed.
 */
function noDeficitFloor(facts: FullAthleteFacts): number | null {
  if (!facts.sex || !facts.heightCm || !facts.weightKg || !facts.ageYears) return null;
  if (bmi(facts.heightCm, facts.weightKg) >= UNDERWEIGHT_BMI) return null;

  return maintenanceKcal(
    {
      sex: facts.sex,
      heightCm: facts.heightCm,
      weightKg: facts.weightKg,
      ageYears: facts.ageYears,
    },
    facts.activityLevel ?? 'light',
    facts.trainingDaysPerWeek ?? 3,
  );
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
  ctx: Ctx,
  input: { calorieTarget?: number; proteinTargetG?: number; goalWeightKg?: number },
): Promise<{ profile: Profile; refusals: string[] }> {
  const current = await getProfile(ctx);
  const facts = await athleteFacts(ctx, current);
  const refusals: string[] = [];

  let calorieTarget = current.calorieTarget;
  if (input.calorieTarget !== undefined) {
    const verdict = checkCalorieTarget(input.calorieTarget, facts);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    calorieTarget = verdict.value;

    const holdAtMaintenance = noDeficitFloor(facts);
    if (holdAtMaintenance !== null && calorieTarget < holdAtMaintenance) {
      refusals.push(
        `${calorieTarget} kcal is below maintenance, and you are already under a ` +
          `healthy weight. Held at ${holdAtMaintenance}. ${SUPPORT_NOTE}`,
      );
      calorieTarget = holdAtMaintenance;
    }
  }

  let proteinTargetG = current.proteinTargetG;
  if (input.proteinTargetG !== undefined) {
    const verdict = checkProteinTarget(input.proteinTargetG, facts);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    proteinTargetG = verdict.value;
  }

  let goalWeightKg = current.goalWeightKg;
  if (input.goalWeightKg !== undefined) {
    const verdict = checkGoalWeight(input.goalWeightKg, current.heightCm);
    if (!verdict.ok && verdict.reason) refusals.push(verdict.reason);
    goalWeightKg = verdict.value;
  }

  await ctx.db.query(
    `update profile
     set calorie_target = $2, protein_target_g = $3, goal_weight_kg = $4, updated_at = now()
     where user_id = $1`,
    [ctx.userId, calorieTarget, proteinTargetG, goalWeightKg],
  );

  return { profile: await getProfile(ctx), refusals };
}

/**
 * Moving him to another timezone. Validated here rather than trusted, because
 * a zone the runtime does not know would make every date in the app throw at
 * the moment it is read rather than at the moment it is set.
 */
export async function setTimezone(ctx: Ctx, zone: string): Promise<Profile> {
  if (!isValidTimeZone(zone)) {
    throw badRequest(`${zone} is not a timezone this server knows`);
  }
  await ctx.db.query(
    'update profile set timezone = $2, updated_at = now() where user_id = $1',
    [ctx.userId, zone],
  );
  return getProfile(ctx);
}

/** A BCP 47 tag like 'de' or 'en-GB'. Loose on purpose: the app knows what it
 *  can render, and an unknown tag falls back rather than failing. */
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export async function setLocale(ctx: Ctx, locale: string | null): Promise<Profile> {
  if (locale !== null && !LOCALE_TAG.test(locale)) {
    throw badRequest(`${locale} is not a language tag`);
  }
  await ctx.db.query(
    'update profile set locale = $2, updated_at = now() where user_id = $1',
    [ctx.userId, locale],
  );
  return getProfile(ctx);
}
