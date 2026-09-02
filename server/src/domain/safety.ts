/**
 * Safety floors, per §7. Hard-coded, below the model.
 *
 * The trainer has tools that change targets. These are the limits it cannot
 * talk its way past: not prompt wording, not a system instruction, but a
 * function that returns `ok: false` and a reason it must relay honestly.
 *
 * Pure, like everything else in domain/.
 */

import {
  type Sex,
  basalMetabolicRate,
  maxWeeklyLossKg,
  referenceWeightKg,
} from './targets';

/**
 * The original floors. They were chosen for one athlete — a 191 cm man cutting
 * from 100 kg — and they are sound for him. For a 155 cm woman, 1800 kcal is
 * above the deficit she needs and 160 g of protein is close to 3 g per kilo.
 *
 * So a floor is now derived from the person whenever the app knows enough
 * about them, and these constants are what it falls back to when it does not.
 * Phil predates the onboarding that collects sex and age, so he keeps exactly
 * the numbers he has always had until he fills them in.
 */
export const MIN_CALORIE_TARGET = 1800;
export const MIN_PROTEIN_TARGET_G = 160;
export const MAX_WEEKLY_LOSS_KG = 1.2;
export const MIN_REST_DAYS_PER_WEEK = 2;
export const MIN_BMI = 20;

/** Never below this, whatever the arithmetic says. */
const ABSOLUTE_KCAL_FLOOR = { male: 1500, female: 1200 } as const;

/** The evidence-based minimum for holding muscle in a deficit, per kg. */
const MIN_PROTEIN_G_PER_KG = 1.6;

/**
 * What the app knows about the body it is setting targets for. Every field is
 * optional because a profile written before onboarding existed has none of
 * them, and the floors have to keep working for that profile unchanged.
 */
export type AthleteFacts = {
  sex?: Sex | null;
  heightCm?: number | null;
  weightKg?: number | null;
  ageYears?: number | null;
};

function known(athlete?: AthleteFacts) {
  if (
    !athlete ||
    !athlete.sex ||
    !athlete.heightCm ||
    !athlete.weightKg ||
    !athlete.ageYears
  ) {
    return null;
  }
  return {
    sex: athlete.sex,
    heightCm: athlete.heightCm,
    weightKg: athlete.weightKg,
    ageYears: athlete.ageYears,
  };
}

/**
 * Nobody should eat below their own resting metabolic rate for long, and
 * nobody should eat below the absolute floor for their sex at all.
 */
export function calorieFloorFor(athlete?: AthleteFacts): number {
  const facts = known(athlete);
  if (!facts) return MIN_CALORIE_TARGET;
  return Math.max(ABSOLUTE_KCAL_FLOOR[facts.sex], basalMetabolicRate(facts));
}

export function proteinFloorFor(athlete?: AthleteFacts): number {
  const facts = known(athlete);
  if (!facts) return MIN_PROTEIN_TARGET_G;
  return Math.round(referenceWeightKg(facts.heightCm, facts.weightKg) * MIN_PROTEIN_G_PER_KG);
}

/** 1% of bodyweight a week, never more than 1.2 kg. */
export function maxWeeklyLossFor(athlete?: AthleteFacts): number {
  const weight = athlete?.weightKg;
  return weight ? maxWeeklyLossKg(weight) : MAX_WEEKLY_LOSS_KG;
}

/** Roughly the energy in a kilo of body fat. Used to size a correction. */
const KCAL_PER_KG_FAT = 7700;
const MIN_RAISE_KCAL = 100;
const MAX_RAISE_KCAL = 500;

export type SafetyVerdict = {
  ok: boolean;
  /** The value that will actually be used — the request, or the floor. */
  value: number;
  reason?: string;
};

export function checkCalorieTarget(kcal: number, athlete?: AthleteFacts): SafetyVerdict {
  const floor = calorieFloorFor(athlete);
  if (!Number.isFinite(kcal) || kcal <= 0) {
    return { ok: false, value: floor, reason: 'Calorie target must be a number.' };
  }
  if (kcal < floor) {
    return {
      ok: false,
      value: floor,
      reason: `${Math.round(kcal)} kcal is below the floor of ${floor}. Held at ${floor}.`,
    };
  }
  return { ok: true, value: Math.round(kcal) };
}

export function checkProteinTarget(grams: number, athlete?: AthleteFacts): SafetyVerdict {
  const floor = proteinFloorFor(athlete);
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, value: floor, reason: 'Protein target must be a number.' };
  }
  if (grams < floor) {
    return {
      ok: false,
      value: floor,
      reason: `${Math.round(grams)}g protein is below the floor of ${floor}g. Held at ${floor}g.`,
    };
  }
  return { ok: true, value: Math.round(grams) };
}

/** The lightest goal weight that still sits at BMI 20 for a given height. */
export function minGoalWeightKg(heightCm: number): number {
  const metres = heightCm / 100;
  return MIN_BMI * metres * metres;
}

export function checkGoalWeight(kg: number, heightCm: number): SafetyVerdict {
  const floor = minGoalWeightKg(heightCm);
  if (!Number.isFinite(kg) || kg <= 0) {
    return { ok: false, value: floor, reason: 'Goal weight must be a number.' };
  }
  if (kg < floor) {
    return {
      ok: false,
      value: floor,
      reason: `${kg}kg would put him under BMI ${MIN_BMI} at ${heightCm}cm. The floor is ${floor.toFixed(1)}kg.`,
    };
  }
  return { ok: true, value: kg };
}

/** §7: at least two rest days a week, whatever the enthusiasm. */
export function checkTrainingDays(daysPerWeek: number): SafetyVerdict {
  const max = 7 - MIN_REST_DAYS_PER_WEEK;
  if (!Number.isFinite(daysPerWeek) || daysPerWeek < 0) {
    return { ok: false, value: 3, reason: 'Training days must be a number.' };
  }
  if (daysPerWeek > max) {
    return {
      ok: false,
      value: max,
      reason: `${daysPerWeek} training days leaves fewer than ${MIN_REST_DAYS_PER_WEEK} rest days. Capped at ${max}.`,
    };
  }
  return { ok: true, value: daysPerWeek };
}

export type LossIntervention = {
  newTarget: number;
  reason: string;
};

/**
 * §7: "If 7-day average loss exceeds 1.2 kg/week for two consecutive weeks,
 * the system raises the calorie target automatically and tells him why."
 *
 * Automatic means automatic — this is not advice the model may choose to give.
 * The size of the raise is derived from how far over the limit he actually is,
 * then bounded, so a bad scale reading cannot swing the target 800 kcal.
 *
 * `weeklyChanges` is most recent first; negative is loss; null is a week
 * without enough weigh-ins to judge.
 */
export function lossRateIntervention(input: {
  weeklyChanges: (number | null)[];
  currentTarget: number;
  athlete?: AthleteFacts;
}): LossIntervention | null {
  const [thisWeek, lastWeek] = input.weeklyChanges;
  const limit = maxWeeklyLossFor(input.athlete);

  // A week we cannot measure is not a week over the limit.
  if (thisWeek == null || lastWeek == null) return null;
  if (thisWeek > -limit || lastWeek > -limit) return null;

  const excessKgPerWeek = Math.abs(thisWeek) - limit;
  const rawKcalPerDay = (excessKgPerWeek * KCAL_PER_KG_FAT) / 7;
  const raise = Math.min(
    MAX_RAISE_KCAL,
    Math.max(MIN_RAISE_KCAL, Math.round(rawKcalPerDay / 50) * 50),
  );

  return {
    newTarget: input.currentTarget + raise,
    reason:
      `Two weeks running you have lost more than ${limit.toFixed(2)} kg/week ` +
      `(${Math.abs(thisWeek).toFixed(1)} and ${Math.abs(lastWeek).toFixed(1)}). ` +
      `That is fast enough to cost muscle, so calories go up ${raise} to ${input.currentTarget + raise}.`,
  };
}
