/**
 * Where a person's daily numbers come from. Pure.
 *
 * §1: the model never computes a number that matters. Calories, protein and
 * the fat floor are arithmetic — Mifflin-St Jeor for resting energy, an
 * activity factor, and a deficit sized from the rate the athlete chose. The
 * trainer explains these numbers; it does not invent them.
 *
 * Phil's targets were typed into a seed migration because there was one
 * athlete and he already knew them. Anyone else arrives with a height and a
 * goal and nothing else, and guessing on their behalf is how an app tells a
 * 60 kg person to eat 2300 kcal.
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Goal = 'lose' | 'maintain' | 'gain';

export type Anthropometrics = {
  sex: Sex;
  heightCm: number;
  weightKg: number;
  ageYears: number;
};

/** Roughly the energy in a kilo of body fat. */
export const KCAL_PER_KG_FAT = 7700;

/**
 * Mifflin-St Jeor. Chosen over Harris-Benedict because it is the more accurate
 * of the two in people who are overweight, which is most of the population
 * that installs a fitness app.
 */
export function basalMetabolicRate(person: Anthropometrics): number {
  const base = 10 * person.weightKg + 6.25 * person.heightCm - 5 * person.ageYears;
  return Math.round(person.sex === 'male' ? base + 5 : base - 161);
}

/**
 * Everything except deliberate training. Training is added separately below, so
 * someone who lifts four times a week and sits down the rest of the time is not
 * described by the same multiplier as a builder who never trains.
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.35,
  moderate: 1.5,
  active: 1.65,
};

/** About what a session of lifting or zone-2 costs, spread across the week. */
const KCAL_PER_SESSION = 350;

export function maintenanceKcal(
  person: Anthropometrics,
  activity: ActivityLevel,
  trainingDaysPerWeek: number,
): number {
  const bmr = basalMetabolicRate(person);
  const daily = bmr * ACTIVITY_FACTORS[activity];
  const training = (Math.max(0, trainingDaysPerWeek) * KCAL_PER_SESSION) / 7;
  return Math.round(daily + training);
}

/**
 * The weight protein and fat are scaled against.
 *
 * Scaling protein on the body weight of someone carrying 40 kg of fat asks
 * them to eat an amount nobody eats. Capping the reference at BMI 25 keeps the
 * number achievable without under-feeding a lean athlete, for whom the cap
 * never binds.
 */
export function referenceWeightKg(heightCm: number, weightKg: number): number {
  const metres = heightCm / 100;
  return Math.min(weightKg, 25 * metres * metres);
}

/**
 * The fastest anyone should lose: 1% of bodyweight a week, never more than
 * 1.2 kg. The percentage is what makes this right for a 55 kg person as well
 * as a 100 kg one — a flat 1.2 kg/week is 2% of her bodyweight.
 */
export const MAX_WEEKLY_LOSS_FRACTION = 0.01;
export const MAX_WEEKLY_LOSS_KG_ABSOLUTE = 1.2;

/**
 * What a cut defaults to when nobody picks a rate: three quarters of the
 * ceiling, not the ceiling. Defaulting somebody to the fastest loss the app
 * permits is a bad default for a general audience, and a worse one for the
 * people §7's floors exist to protect.
 */
export const DEFAULT_WEEKLY_LOSS_FRACTION = 0.0075;

export function maxWeeklyLossKg(weightKg: number): number {
  return Math.min(weightKg * MAX_WEEKLY_LOSS_FRACTION, MAX_WEEKLY_LOSS_KG_ABSOLUTE);
}

/** A lean gain. Faster than this is mostly fat, whatever the enthusiasm. */
export const MAX_WEEKLY_GAIN_KG = 0.35;

/** Grams per kilo of reference weight. Higher in a deficit, to hold muscle. */
const PROTEIN_G_PER_KG = { lose: 2.0, maintain: 1.8, gain: 1.8 } as const;

/** The minimum for hormonal health, not a target — fat above this is fine. */
const FAT_G_PER_KG = 0.8;
const FAT_FLOOR_MINIMUM_G = 40;

/** No deficit deeper than this share of maintenance, whatever rate was asked. */
const MAX_DEFICIT_FRACTION = 0.25;
const MAX_SURPLUS_FRACTION = 0.15;

export type TargetInput = Anthropometrics & {
  activity: ActivityLevel;
  goal: Goal;
  trainingDaysPerWeek: number;
  /** Desired kg per week. Positive for both directions; clamped below. */
  weeklyRateKg?: number;
};

export type ComputedTargets = {
  maintenanceKcal: number;
  calorieTarget: number;
  proteinTargetG: number;
  fatFloorG: number;
  /** The rate actually used, after clamping. Negative is loss. */
  weeklyRateKg: number;
  /** Anything that was clamped, in words the trainer can relay. */
  notes: string[];
};

/**
 * The whole calculation, in one place, so there is one answer to "where did
 * 2100 come from" and it can be read out loud.
 */
export function computeTargets(input: TargetInput): ComputedTargets {
  const notes: string[] = [];
  const maintenance = maintenanceKcal(input, input.activity, input.trainingDaysPerWeek);
  const reference = referenceWeightKg(input.heightCm, input.weightKg);

  let weeklyRateKg = 0;
  let calorieTarget = maintenance;

  if (input.goal === 'lose') {
    const ceiling = maxWeeklyLossKg(input.weightKg);
    const asked = Math.abs(
      input.weeklyRateKg ?? input.weightKg * DEFAULT_WEEKLY_LOSS_FRACTION,
    );
    let rate = Math.min(asked, ceiling);
    if (asked > ceiling) {
      notes.push(
        `${asked.toFixed(2)} kg a week is faster than 1% of bodyweight. Using ${rate.toFixed(2)} kg.`,
      );
    }

    let deficit = (rate * KCAL_PER_KG_FAT) / 7;
    const maxDeficit = maintenance * MAX_DEFICIT_FRACTION;
    if (deficit > maxDeficit) {
      deficit = maxDeficit;
      rate = (deficit * 7) / KCAL_PER_KG_FAT;
      notes.push(
        `A deficit that size is more than a quarter of maintenance. Held at ${Math.round(deficit)} kcal, about ${rate.toFixed(2)} kg a week.`,
      );
    }

    calorieTarget = Math.round(maintenance - deficit);
    weeklyRateKg = -rate;
  }

  if (input.goal === 'gain') {
    const asked = Math.abs(input.weeklyRateKg ?? MAX_WEEKLY_GAIN_KG);
    let rate = Math.min(asked, MAX_WEEKLY_GAIN_KG);
    if (asked > MAX_WEEKLY_GAIN_KG) {
      notes.push(
        `Gaining faster than ${MAX_WEEKLY_GAIN_KG} kg a week is mostly fat. Using ${rate.toFixed(2)} kg.`,
      );
    }

    let surplus = (rate * KCAL_PER_KG_FAT) / 7;
    const maxSurplus = maintenance * MAX_SURPLUS_FRACTION;
    if (surplus > maxSurplus) {
      surplus = maxSurplus;
      rate = (surplus * 7) / KCAL_PER_KG_FAT;
    }

    calorieTarget = Math.round(maintenance + surplus);
    weeklyRateKg = rate;
  }

  return {
    maintenanceKcal: maintenance,
    calorieTarget,
    proteinTargetG: Math.round(reference * PROTEIN_G_PER_KG[input.goal]),
    fatFloorG: Math.max(FAT_FLOOR_MINIMUM_G, Math.round(reference * FAT_G_PER_KG)),
    weeklyRateKg: Math.round(weeklyRateKg * 100) / 100,
    notes,
  };
}

/**
 * A starting point for the activity question, phrased as training days rather
 * than as a word nobody agrees on the meaning of. The athlete can override it.
 */
export function suggestActivity(trainingDaysPerWeek: number): ActivityLevel {
  if (trainingDaysPerWeek <= 1) return 'sedentary';
  if (trainingDaysPerWeek <= 3) return 'light';
  if (trainingDaysPerWeek <= 5) return 'moderate';
  return 'active';
}

export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return now.getUTCFullYear() - birthYear;
}
