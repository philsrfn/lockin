import { describe, expect, it } from 'vitest';
import {
  MAX_WEEKLY_LOSS_KG,
  MIN_CALORIE_TARGET,
  MIN_PROTEIN_TARGET_G,
  checkCalorieTarget,
  checkGoalWeight,
  checkProteinTarget,
  checkTrainingDays,
  lossRateIntervention,
  minGoalWeightKg,
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
