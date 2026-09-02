import { describe, expect, it } from 'vitest';
import {
  MAX_WEEKLY_LOSS_KG,
  MIN_CALORIE_TARGET,
  MIN_PROTEIN_TARGET_G,
  calorieFloorFor,
  checkCalorieTarget,
  checkGoalWeight,
  checkProteinTarget,
  checkTrainingDays,
  lossRateIntervention,
  minGoalWeightKg,
  proteinFloorFor,
} from '../safety';

describe('checkCalorieTarget', () => {
  it('allows a target at or above the floor', () => {
    expect(checkCalorieTarget(2300)).toEqual({ ok: true, value: 2300 });
    expect(checkCalorieTarget(MIN_CALORIE_TARGET)).toEqual({ ok: true, value: 1800 });
  });

  it('refuses to go below the floor and clamps to it', () => {
    const verdict = checkCalorieTarget(1500);
    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBe(MIN_CALORIE_TARGET);
    expect(verdict.reason).toContain('1800');
  });

  it('rejects nonsense rather than clamping it', () => {
    expect(checkCalorieTarget(Number.NaN).ok).toBe(false);
    expect(checkCalorieTarget(-500).ok).toBe(false);
  });
});

describe('checkProteinTarget', () => {
  it('allows 190g', () => {
    expect(checkProteinTarget(190).ok).toBe(true);
  });

  it('refuses anything under 160g — the "never" rule, in code', () => {
    const verdict = checkProteinTarget(120);
    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBe(MIN_PROTEIN_TARGET_G);
  });
});

describe('minGoalWeightKg', () => {
  it('is BMI 20 for his height', () => {
    // 20 * 1.91^2 = 72.96
    expect(minGoalWeightKg(191)).toBeCloseTo(72.96, 1);
  });
});

describe('checkGoalWeight', () => {
  it('allows the 80kg goal', () => {
    expect(checkGoalWeight(80, 191).ok).toBe(true);
  });

  it('refuses a goal under BMI 20 and clamps to it', () => {
    const verdict = checkGoalWeight(68, 191);
    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBeCloseTo(72.96, 1);
    expect(verdict.reason).toMatch(/BMI/i);
  });
});

describe('checkTrainingDays', () => {
  it('allows three strength days', () => {
    expect(checkTrainingDays(3).ok).toBe(true);
  });

  it('refuses six, which leaves fewer than two rest days', () => {
    const verdict = checkTrainingDays(6);
    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBe(5);
  });
});

describe('lossRateIntervention', () => {
  it('does nothing while loss is inside the safe rate', () => {
    expect(
      lossRateIntervention({ weeklyChanges: [-0.8, -0.9], currentTarget: 2300 }),
    ).toBeNull();
  });

  it('does nothing after a single fast week', () => {
    expect(
      lossRateIntervention({ weeklyChanges: [-1.5, -0.7], currentTarget: 2300 }),
    ).toBeNull();
  });

  it('raises the target after two consecutive weeks over the limit', () => {
    const action = lossRateIntervention({ weeklyChanges: [-1.5, -1.4], currentTarget: 2300 });
    expect(action).not.toBeNull();
    // 1.5 - 1.2 = 0.3 kg/wk excess -> 0.3 * 7700 / 7 = 330 kcal/day, to nearest 50
    expect(action!.newTarget).toBe(2650);
    expect(action!.reason).toContain('1.2');
  });

  it('never raises by a wild amount, however fast the drop', () => {
    const action = lossRateIntervention({ weeklyChanges: [-4, -3.5], currentTarget: 2300 });
    expect(action!.newTarget).toBe(2800); // capped at +500
  });

  it('always raises by something once it has tripped', () => {
    const action = lossRateIntervention({ weeklyChanges: [-1.21, -1.21], currentTarget: 2300 });
    expect(action!.newTarget).toBeGreaterThan(2300);
  });

  it('ignores weeks with no data rather than treating them as zero', () => {
    expect(lossRateIntervention({ weeklyChanges: [null, -1.5], currentTarget: 2300 })).toBeNull();
    expect(lossRateIntervention({ weeklyChanges: [-1.5], currentTarget: 2300 })).toBeNull();
  });

  it('does not fire on weight gain', () => {
    expect(lossRateIntervention({ weeklyChanges: [1.5, 1.4], currentTarget: 2300 })).toBeNull();
  });

  it('uses the documented limit', () => {
    expect(MAX_WEEKLY_LOSS_KG).toBe(1.2);
  });
});

describe('floors derived from the person', () => {
  const SMALL = { sex: 'female', heightCm: 155, weightKg: 60, ageYears: 30 } as const;
  const PHIL = { sex: 'male', heightCm: 191, weightKg: 93, ageYears: 30 } as const;

  it('falls back to the seeded constants when the body is unknown', () => {
    // Phil predates onboarding: no sex, no birth year. He must keep exactly
    // the floors he has always had.
    expect(calorieFloorFor()).toBe(MIN_CALORIE_TARGET);
    expect(calorieFloorFor({ heightCm: 191, weightKg: 93 })).toBe(MIN_CALORIE_TARGET);
    expect(proteinFloorFor({ sex: 'male' })).toBe(MIN_PROTEIN_TARGET_G);
  });

  it('puts the calorie floor at resting metabolic rate once it knows the body', () => {
    expect(calorieFloorFor(PHIL)).toBe(1979);
  });

  it('lets a small woman eat in a deficit the old flat floor forbade', () => {
    // 1800 kcal was above the target she needs; the app would have told her to
    // eat more than maintenance and called it a cut.
    expect(calorieFloorFor(SMALL)).toBeLessThan(MIN_CALORIE_TARGET);
    expect(calorieFloorFor(SMALL)).toBeGreaterThanOrEqual(1200);
  });

  it('never drops below the absolute floor for the sex', () => {
    const tiny = { sex: 'female', heightCm: 150, weightKg: 42, ageYears: 60 } as const;

    expect(calorieFloorFor(tiny)).toBe(1200);
  });

  it('scales the protein floor to the body rather than to 160g', () => {
    expect(proteinFloorFor(SMALL)).toBeLessThan(MIN_PROTEIN_TARGET_G);
    expect(proteinFloorFor(SMALL)).toBeGreaterThan(80);
  });

  it('holds a target at the derived floor and names the number', () => {
    const verdict = checkCalorieTarget(900, SMALL);

    expect(verdict.ok).toBe(false);
    expect(verdict.value).toBe(calorieFloorFor(SMALL));
    expect(verdict.reason).toContain(String(calorieFloorFor(SMALL)));
  });

  it('accepts a target a flat 1800 floor would have refused', () => {
    expect(checkCalorieTarget(1500, SMALL).ok).toBe(true);
  });

  it('accepts a protein target the flat 160g floor would have refused', () => {
    expect(checkProteinTarget(110, SMALL).ok).toBe(true);
    expect(checkProteinTarget(110).ok).toBe(false);
  });

  it('intervenes on a loss rate that is 1% of her bodyweight, not 1.2kg', () => {
    // 0.7 kg/week is fine for Phil and too fast for her.
    const forHer = lossRateIntervention({
      weeklyChanges: [-0.7, -0.7],
      currentTarget: 1600,
      athlete: SMALL,
    });
    const forHim = lossRateIntervention({
      weeklyChanges: [-0.7, -0.7],
      currentTarget: 2300,
      athlete: PHIL,
    });

    expect(forHer).not.toBeNull();
    expect(forHim).toBeNull();
  });

  it('still uses 1.2kg when it does not know the bodyweight', () => {
    expect(lossRateIntervention({ weeklyChanges: [-1.0, -1.0], currentTarget: 2300 })).toBeNull();
    expect(
      lossRateIntervention({ weeklyChanges: [-1.5, -1.5], currentTarget: 2300 }),
    ).not.toBeNull();
  });
});
