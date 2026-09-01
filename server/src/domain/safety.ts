/**
 * Safety floors, per §7. Hard-coded, below the model.
 *
 * The trainer has tools that change targets. These are the limits it cannot
 * talk its way past: not prompt wording, not a system instruction, but a
 * function that returns `ok: false` and a reason it must relay honestly.
 *
 * Pure, like everything else in domain/.
 */

export const MIN_CALORIE_TARGET = 1800;
export const MIN_PROTEIN_TARGET_G = 160;
export const MAX_WEEKLY_LOSS_KG = 1.2;
export const MIN_REST_DAYS_PER_WEEK = 2;
export const MIN_BMI = 20;

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

export function checkCalorieTarget(kcal: number): SafetyVerdict {
  if (!Number.isFinite(kcal) || kcal <= 0) {
    return { ok: false, value: MIN_CALORIE_TARGET, reason: 'Calorie target must be a number.' };
  }
  if (kcal < MIN_CALORIE_TARGET) {
    return {
      ok: false,
      value: MIN_CALORIE_TARGET,
      reason: `${Math.round(kcal)} kcal is below the floor of ${MIN_CALORIE_TARGET}. Held at ${MIN_CALORIE_TARGET}.`,
    };
  }
  return { ok: true, value: Math.round(kcal) };
}

export function checkProteinTarget(grams: number): SafetyVerdict {
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, value: MIN_PROTEIN_TARGET_G, reason: 'Protein target must be a number.' };
  }
  if (grams < MIN_PROTEIN_TARGET_G) {
    return {
      ok: false,
      value: MIN_PROTEIN_TARGET_G,
      reason: `${Math.round(grams)}g protein is below the floor of ${MIN_PROTEIN_TARGET_G}g. Held at ${MIN_PROTEIN_TARGET_G}g.`,
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
}): LossIntervention | null {
  const [thisWeek, lastWeek] = input.weeklyChanges;

  // A week we cannot measure is not a week over the limit.
  if (thisWeek == null || lastWeek == null) return null;
  if (thisWeek > -MAX_WEEKLY_LOSS_KG || lastWeek > -MAX_WEEKLY_LOSS_KG) return null;

  const excessKgPerWeek = Math.abs(thisWeek) - MAX_WEEKLY_LOSS_KG;
  const rawKcalPerDay = (excessKgPerWeek * KCAL_PER_KG_FAT) / 7;
  const raise = Math.min(
    MAX_RAISE_KCAL,
    Math.max(MIN_RAISE_KCAL, Math.round(rawKcalPerDay / 50) * 50),
  );

  return {
    newTarget: input.currentTarget + raise,
    reason:
      `Two weeks running you have lost more than ${MAX_WEEKLY_LOSS_KG} kg/week ` +
      `(${Math.abs(thisWeek).toFixed(1)} and ${Math.abs(lastWeek).toFixed(1)}). ` +
      `That is fast enough to cost muscle, so calories go up ${raise} to ${input.currentTarget + raise}.`,
  };
}
