/**
 * The questionnaire, and the arithmetic behind the numbers it produces.
 *
 * §1: the model never computes a number that matters. Nothing here asks Gemini
 * anything — it is Mifflin-St Jeor, an activity factor, a deficit sized from
 * the rate the athlete chose, and then the §7 floors, which are now derived
 * from the body in front of us rather than from Phil's.
 *
 * The athlete is told where the numbers came from. A target you cannot explain
 * is a target people stop believing after a bad week.
 */
import { type Ctx, transactionFor } from '../db';
import {
  type ActivityLevel,
  type Goal,
  type Sex,
  ageFromBirthYear,
  computeTargets,
  suggestActivity,
} from '../domain/targets';
import {
  checkCalorieTarget,
  checkGoalWeight,
  checkProteinTarget,
  checkTrainingDays,
  proteinFloorFor,
} from '../domain/safety';
import { isValidTimeZone } from '../domain/time';
import { badRequest } from '../errors';
import { type Profile, getProfile } from './profile';
import { logWeight } from './bodyweight';

export type OnboardingInput = {
  name?: string | null;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  goal: Goal;
  goalWeightKg?: number | null;
  trainingDaysPerWeek: number;
  activity?: ActivityLevel;
  /** Desired kg per week. Clamped by the §7 rate limits. */
  weeklyRateKg?: number;
  timezone?: string;
  /** BCP 47, from the device. The athlete can change it later. */
  locale?: string;
};

export type OnboardingResult = {
  profile: Profile;
  /** Where the numbers came from, for the screen that shows its working. */
  explanation: {
    maintenanceKcal: number;
    weeklyRateKg: number;
    notes: string[];
  };
};

/** Bounds that catch a slipped decimal point rather than a lifestyle. */
const HEIGHT_CM = { min: 120, max: 250 };
const WEIGHT_KG = { min: 30, max: 300 };
const AGE_YEARS = { min: 14, max: 100 };

function validate(input: OnboardingInput): void {
  if (input.sex !== 'male' && input.sex !== 'female') {
    throw badRequest('sex must be male or female — it changes the resting metabolic rate formula');
  }
  if (!['lose', 'maintain', 'gain'].includes(input.goal)) {
    throw badRequest('goal must be lose, maintain or gain');
  }
  if (!Number.isFinite(input.heightCm) || input.heightCm < HEIGHT_CM.min || input.heightCm > HEIGHT_CM.max) {
    throw badRequest(`heightCm must be between ${HEIGHT_CM.min} and ${HEIGHT_CM.max}`);
  }
  if (!Number.isFinite(input.weightKg) || input.weightKg < WEIGHT_KG.min || input.weightKg > WEIGHT_KG.max) {
    throw badRequest(`weightKg must be between ${WEIGHT_KG.min} and ${WEIGHT_KG.max}`);
  }

  const age = ageFromBirthYear(input.birthYear);
  if (!Number.isFinite(age) || age < AGE_YEARS.min || age > AGE_YEARS.max) {
    throw badRequest(`birthYear puts you at ${age}, which is outside ${AGE_YEARS.min}–${AGE_YEARS.max}`);
  }
  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw badRequest(`${input.timezone} is not a timezone this server knows`);
  }
}

/**
 * Answering the questionnaire. Idempotent: running it again re-computes from
 * the new answers, which is what "I got it wrong, let me redo it" needs.
 */
export async function completeOnboarding(
  ctx: Ctx,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  validate(input);

  const ageYears = ageFromBirthYear(input.birthYear);
  const notes: string[] = [];

  // §7's rest-day floor applies to the answer, not just to what the model
  // later proposes: six training days a week is refused here too.
  const days = checkTrainingDays(input.trainingDaysPerWeek);
  if (!days.ok && days.reason) notes.push(days.reason);

  const activity = input.activity ?? suggestActivity(days.value);

  const computed = computeTargets({
    sex: input.sex,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    ageYears,
    activity,
    goal: input.goal,
    trainingDaysPerWeek: days.value,
    weeklyRateKg: input.weeklyRateKg,
  });
  notes.push(...computed.notes);

  const facts = {
    sex: input.sex,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    ageYears,
  };

  // The floors sit below the arithmetic, not beside it: a computed target that
  // falls under one is raised, and the athlete is told.
  const calories = checkCalorieTarget(computed.calorieTarget, facts);
  if (!calories.ok && calories.reason) notes.push(calories.reason);

  const protein = checkProteinTarget(computed.proteinTargetG, facts);
  if (!protein.ok && protein.reason) notes.push(protein.reason);

  let goalWeightKg = input.goalWeightKg ?? null;
  if (goalWeightKg != null) {
    const verdict = checkGoalWeight(goalWeightKg, input.heightCm);
    if (!verdict.ok && verdict.reason) notes.push(verdict.reason);
    goalWeightKg = Math.round(verdict.value * 10) / 10;
  }

  return transactionFor(ctx, async (inner) => {
    await inner.db.query(
      `update profile
       set name = coalesce($2, name),
           sex = $3,
           birth_year = $4,
           height_cm = $5,
           goal = $6,
           goal_weight_kg = $7,
           activity_level = $8,
           training_days_per_week = $9,
           weekly_rate_kg = $10,
           calorie_target = $11,
           protein_target_g = $12,
           fat_floor_g = $13,
           timezone = coalesce($14, timezone),
           locale = coalesce($15, locale),
           onboarded_at = now(),
           updated_at = now()
       where user_id = $1`,
      [
        inner.userId,
        input.name ?? null,
        input.sex,
        input.birthYear,
        Math.round(input.heightCm),
        input.goal,
        goalWeightKg,
        activity,
        days.value,
        computed.weeklyRateKg,
        calories.value,
        protein.value,
        computed.fatFloorG,
        input.timezone ?? null,
        input.locale ?? null,
      ],
    );

    // The stated weight becomes the first point of the trend, so the seven-day
    // average has something to average from day one.
    await logWeight(inner, { weightKg: input.weightKg }, input.timezone);

    // The seeded protein rule names a number. It has to be this athlete's,
    // or the rule the validator enforces is one they can never satisfy.
    await inner.db.query(
      `update rules
       set text = $2
       where user_id = $1 and code = 'min_daily_protein'`,
      [
        inner.userId,
        `Never propose a day under ${proteinFloorFor(facts)}g protein.`,
      ],
    );

    return {
      profile: await getProfile(inner),
      explanation: {
        maintenanceKcal: computed.maintenanceKcal,
        weeklyRateKg: computed.weeklyRateKg,
        notes,
      },
    };
  });
}
