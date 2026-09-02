import { describe, expect, it } from 'vitest';
import {
  ageFromBirthYear,
  basalMetabolicRate,
  computeTargets,
  maintenanceKcal,
  maxWeeklyLossKg,
  referenceWeightKg,
  suggestActivity,
} from '../targets';

const PHIL = { sex: 'male', heightCm: 191, weightKg: 93, ageYears: 30 } as const;
// 155 cm, 60 kg — the athlete the flat 1800 kcal / 160 g floors were wrong for.
const SMALL = { sex: 'female', heightCm: 155, weightKg: 60, ageYears: 30 } as const;

describe('basalMetabolicRate', () => {
  it('follows Mifflin-St Jeor for a man', () => {
    // 10×93 + 6.25×191 − 5×30 + 5
    expect(basalMetabolicRate(PHIL)).toBe(1979);
  });

  it('follows Mifflin-St Jeor for a woman', () => {
    // 10×60 + 6.25×155 − 5×30 − 161
    expect(basalMetabolicRate(SMALL)).toBe(1258);
  });

  it('falls with age', () => {
    expect(basalMetabolicRate({ ...PHIL, ageYears: 50 })).toBeLessThan(basalMetabolicRate(PHIL));
  });
});

describe('maintenanceKcal', () => {
  it('adds the cost of training on top of daily activity', () => {
    const lifting = maintenanceKcal(PHIL, 'sedentary', 4);
    const not = maintenanceKcal(PHIL, 'sedentary', 0);

    expect(lifting).toBeGreaterThan(not);
    expect(lifting - not).toBe(200); // 4 × 350 / 7
  });

  it('separates training from the rest of the day', () => {
    // Someone who lifts four times and sits down the rest of the week is not
    // the same as a builder who never trains.
    const deskLifter = maintenanceKcal(PHIL, 'sedentary', 4);
    const activeNonLifter = maintenanceKcal(PHIL, 'active', 0);

    expect(activeNonLifter).toBeGreaterThan(deskLifter);
  });
});

describe('referenceWeightKg', () => {
  it('is bodyweight for someone lean', () => {
    expect(referenceWeightKg(191, 80)).toBe(80);
  });

  it('caps at BMI 25, so protein stays an amount somebody could eat', () => {
    // 25 × 1.91² = 91.2
    expect(referenceWeightKg(191, 130)).toBeCloseTo(91.2, 1);
  });
});

describe('maxWeeklyLossKg', () => {
  it('is 1% of bodyweight', () => {
    expect(maxWeeklyLossKg(60)).toBeCloseTo(0.6, 5);
  });

  it('never exceeds 1.2kg, however heavy', () => {
    expect(maxWeeklyLossKg(160)).toBe(1.2);
  });

  it('is stricter for a small person than the old flat limit', () => {
    // The whole point: 1.2 kg/week is 2% of her bodyweight.
    expect(maxWeeklyLossKg(60)).toBeLessThan(1.2);
  });
});

describe('computeTargets', () => {
  it('puts a maintainer at maintenance', () => {
    const result = computeTargets({
      ...PHIL,
      activity: 'light',
      goal: 'maintain',
      trainingDaysPerWeek: 3,
    });

    expect(result.calorieTarget).toBe(result.maintenanceKcal);
    expect(result.weeklyRateKg).toBe(0);
  });

  it('sizes the deficit from the rate, at 7700 kcal a kilo', () => {
    const result = computeTargets({
      ...PHIL,
      activity: 'light',
      goal: 'lose',
      trainingDaysPerWeek: 3,
      weeklyRateKg: 0.5,
    });

    // 0.5 × 7700 / 7 = 550
    expect(result.maintenanceKcal - result.calorieTarget).toBe(550);
    expect(result.weeklyRateKg).toBe(-0.5);
  });

  it('clamps a rate faster than 1% of bodyweight, and says so', () => {
    const result = computeTargets({
      ...SMALL,
      activity: 'light',
      goal: 'lose',
      trainingDaysPerWeek: 3,
      weeklyRateKg: 1.2,
    });

    // Both guards bite, in order: 1.2 kg is 2% of her bodyweight, so the rate
    // comes down to 0.6 — and a 0.6 kg/week deficit is more than a quarter of
    // her maintenance, so it comes down again. She is told about both.
    expect(result.weeklyRateKg).toBeGreaterThan(-0.6);
    expect(result.weeklyRateKg).toBeLessThan(0);
    expect(result.notes.join(' ')).toContain('1% of bodyweight');
    expect(result.notes.join(' ')).toContain('quarter of maintenance');
  });

  it('never cuts more than a quarter of maintenance', () => {
    const result = computeTargets({
      sex: 'male',
      heightCm: 185,
      weightKg: 120,
      ageYears: 30,
      activity: 'sedentary',
      goal: 'lose',
      trainingDaysPerWeek: 0,
      weeklyRateKg: 1.2,
    });

    expect(result.calorieTarget).toBeGreaterThanOrEqual(result.maintenanceKcal * 0.75);
    expect(result.notes.join(' ')).toContain('quarter of maintenance');
  });

  it('reports the rate it actually used after clamping, not the one asked for', () => {
    const result = computeTargets({
      sex: 'male',
      heightCm: 185,
      weightKg: 120,
      ageYears: 30,
      activity: 'sedentary',
      goal: 'lose',
      trainingDaysPerWeek: 0,
      weeklyRateKg: 1.2,
    });

    expect(Math.abs(result.weeklyRateKg)).toBeLessThan(1.2);
  });

  it('defaults a cut to the fastest safe rate rather than to nothing', () => {
    const result = computeTargets({
      ...PHIL,
      activity: 'light',
      goal: 'lose',
      trainingDaysPerWeek: 3,
    });

    expect(result.weeklyRateKg).toBeLessThan(0);
  });

  it('caps a bulk at a rate that is not mostly fat', () => {
    const result = computeTargets({
      ...PHIL,
      activity: 'light',
      goal: 'gain',
      trainingDaysPerWeek: 4,
      weeklyRateKg: 1,
    });

    expect(result.weeklyRateKg).toBe(0.35);
    expect(result.calorieTarget).toBeGreaterThan(result.maintenanceKcal);
    expect(result.notes.join(' ')).toContain('mostly fat');
  });

  it('asks for more protein in a deficit than at maintenance', () => {
    const cutting = computeTargets({ ...PHIL, activity: 'light', goal: 'lose', trainingDaysPerWeek: 3 });
    const holding = computeTargets({ ...PHIL, activity: 'light', goal: 'maintain', trainingDaysPerWeek: 3 });

    expect(cutting.proteinTargetG).toBeGreaterThan(holding.proteinTargetG);
  });

  it('scales protein on reference weight, so a heavy athlete is not asked to eat 260g', () => {
    const result = computeTargets({
      sex: 'male',
      heightCm: 185,
      weightKg: 130,
      ageYears: 30,
      activity: 'sedentary',
      goal: 'lose',
      trainingDaysPerWeek: 3,
    });

    // 25 × 1.85² = 85.6 kg reference, × 2.0
    expect(result.proteinTargetG).toBeCloseTo(171, -1);
    expect(result.proteinTargetG).toBeLessThan(200);
  });

  it('gives a small athlete numbers that fit her, not Phil\'s', () => {
    const result = computeTargets({
      ...SMALL,
      activity: 'light',
      goal: 'lose',
      trainingDaysPerWeek: 3,
    });

    // Every one of these would have been wrong under the seeded constants.
    expect(result.calorieTarget).toBeLessThan(1800);
    expect(result.proteinTargetG).toBeLessThan(160);
    expect(result.proteinTargetG).toBeGreaterThan(100);
    expect(result.fatFloorG).toBeGreaterThanOrEqual(40);
  });

  it('never sets a fat floor below the hormonal minimum', () => {
    const result = computeTargets({
      sex: 'female',
      heightCm: 150,
      weightKg: 45,
      ageYears: 25,
      activity: 'sedentary',
      goal: 'maintain',
      trainingDaysPerWeek: 2,
    });

    expect(result.fatFloorG).toBe(40);
  });

  it('reproduces something close to the numbers Phil was seeded with', () => {
    // Not a coincidence worth engineering, but a sanity check that the formula
    // lands near what a coach picked for him by hand: 2300 kcal, 190g protein.
    const result = computeTargets({
      ...PHIL,
      weightKg: 100,
      activity: 'light',
      goal: 'lose',
      trainingDaysPerWeek: 3,
      weeklyRateKg: 0.8,
    });

    expect(result.calorieTarget).toBeGreaterThan(2000);
    expect(result.calorieTarget).toBeLessThan(2600);
    expect(result.proteinTargetG).toBeGreaterThan(170);
  });
});

describe('suggestActivity', () => {
  it('climbs with training days', () => {
    expect(suggestActivity(0)).toBe('sedentary');
    expect(suggestActivity(3)).toBe('light');
    expect(suggestActivity(5)).toBe('moderate');
    expect(suggestActivity(6)).toBe('active');
  });
});

describe('ageFromBirthYear', () => {
  it('is years elapsed, which is close enough for a BMR', () => {
    expect(ageFromBirthYear(1996, new Date('2026-09-02T00:00:00Z'))).toBe(30);
  });
});
