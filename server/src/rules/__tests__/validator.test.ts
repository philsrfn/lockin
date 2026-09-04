import { describe, expect, it } from 'vitest';
import type { MealPlanDay, Rule, TrainingWeek } from '../schema';
import { blocks } from '../schema';
import { validateMealPlan, validateTrainingWeek } from '../validator';

const RULES: Rule[] = [
  {
    id: 1,
    tier: 'hard',
    code: 'breakfast_skyr',
    scope: null,
    active: true,
    text: 'Breakfast is always ~500g Skyr with berries and 40g oats. No substitutions.',
  },
  {
    id: 2,
    tier: 'hard',
    code: 'home_dinner_moms_food',
    scope: 'Home',
    active: true,
    text: "When context is Home, dinner is half a portion of mom's food plus a protein add-on.",
  },
  {
    id: 3,
    tier: 'never',
    code: 'min_daily_protein',
    scope: null,
    active: true,
    text: 'Never propose a day under 160g protein.',
  },
  {
    id: 4,
    tier: 'never',
    code: 'no_intervals_on_football_day',
    scope: null,
    active: true,
    text: 'Never schedule hard intervals on a football day.',
  },
  {
    id: 5,
    tier: 'soft',
    code: 'prefer_treadmill',
    scope: null,
    active: true,
    text: 'Prefer treadmill over outdoor running.',
  },
];

const skyrBreakfast = {
  slot: 'breakfast' as const,
  description: '500g Skyr with frozen berries and 40g oats',
  kcal: 520,
  proteinG: 55,
};

function dayWith(meals: MealPlanDay['meals']): MealPlanDay {
  return { meals };
}

describe('the Skyr rule', () => {
  it('passes a breakfast that is Skyr, berries and oats', () => {
    const violations = validateMealPlan(dayWith([skyrBreakfast]), RULES, 'City A');
    expect(violations.filter((v) => v.code === 'breakfast_skyr')).toHaveLength(0);
  });

  it('rejects a breakfast with no Skyr — the explicit case from the spec', () => {
    const violations = validateMealPlan(
      dayWith([
        { slot: 'breakfast', description: 'Scrambled eggs and toast', kcal: 500, proteinG: 30 },
      ]),
      RULES,
      'City A',
    );
    const violation = violations.find((v) => v.code === 'breakfast_skyr');
    expect(violation).toBeDefined();
    expect(violation!.tier).toBe('hard');
    expect(violation!.message).toMatch(/skyr/i);
    expect(blocks(violations)).toBe(true);
  });

  it('rejects Skyr without the oats', () => {
    const violations = validateMealPlan(
      dayWith([{ slot: 'breakfast', description: '500g Skyr with berries', kcal: 400, proteinG: 50 }]),
      RULES,
      'City A',
    );
    expect(violations.find((v) => v.code === 'breakfast_skyr')?.message).toMatch(/oats/i);
  });

  it('rejects Skyr without the berries', () => {
    const violations = validateMealPlan(
      dayWith([{ slot: 'breakfast', description: '500g Skyr and 40g oats', kcal: 450, proteinG: 52 }]),
      RULES,
      'City A',
    );
    expect(violations.find((v) => v.code === 'breakfast_skyr')?.message).toMatch(/berries/i);
  });

  it('accepts the German words he would actually type', () => {
    const violations = validateMealPlan(
      dayWith([
        { slot: 'breakfast', description: '500g Skyr mit Beeren und 40g Haferflocken', kcal: 520, proteinG: 55 },
      ]),
      RULES,
      'City A',
    );
    expect(violations.filter((v) => v.code === 'breakfast_skyr')).toHaveLength(0);
  });

  it('flags a day that skips breakfast entirely', () => {
    const violations = validateMealPlan(
      dayWith([{ slot: 'lunch', description: 'Soy chunk bowl', kcal: 700, proteinG: 60 }]),
      RULES,
      'City A',
    );
    expect(violations.find((v) => v.code === 'breakfast_skyr')).toBeDefined();
  });
});

describe('the Home dinner rule', () => {
  const homeDinner = {
    slot: 'dinner' as const,
    description: "Half a portion of mom's food plus 200g Magerquark",
    kcal: 600,
    proteinG: 45,
  };

  it('applies at Home', () => {
    const violations = validateMealPlan(dayWith([skyrBreakfast, homeDinner]), RULES, 'Home');
    expect(violations.filter((v) => v.code === 'home_dinner_moms_food')).toHaveLength(0);
  });

  it('rejects a full portion with no protein add-on at Home', () => {
    const violations = validateMealPlan(
      dayWith([
        skyrBreakfast,
        { slot: 'dinner', description: "Mom's lasagne", kcal: 900, proteinG: 35 },
      ]),
      RULES,
      'Home',
    );
    expect(violations.find((v) => v.code === 'home_dinner_moms_food')).toBeDefined();
  });

  it('does not apply in City C, because the rule is scoped to Home', () => {
    const violations = validateMealPlan(
      dayWith([
        skyrBreakfast,
        { slot: 'dinner', description: 'Chicken and rice', kcal: 700, proteinG: 55 },
      ]),
      RULES,
      'City C',
    );
    expect(violations.filter((v) => v.code === 'home_dinner_moms_food')).toHaveLength(0);
  });
});

describe('the protein floor', () => {
  it('passes a day over 160g', () => {
    const violations = validateMealPlan(
      dayWith([
        skyrBreakfast,
        { slot: 'lunch', description: 'Soy chunk bowl', kcal: 700, proteinG: 60 },
        { slot: 'dinner', description: "Half mom's food plus quark", kcal: 600, proteinG: 50 },
      ]),
      RULES,
      'Home',
    );
    expect(violations.filter((v) => v.code === 'min_daily_protein')).toHaveLength(0);
  });

  it('blocks a day under 160g however good the rest looks', () => {
    const violations = validateMealPlan(
      dayWith([
        skyrBreakfast,
        { slot: 'lunch', description: 'Salad', kcal: 300, proteinG: 10 },
      ]),
      RULES,
      'City A',
    );
    const violation = violations.find((v) => v.code === 'min_daily_protein');
    expect(violation).toBeDefined();
    expect(violation!.tier).toBe('never');
    expect(violation!.message).toMatch(/160/);
    expect(blocks(violations)).toBe(true);
  });
});

describe('training week rules', () => {
  const week = (days: TrainingWeek['days']): TrainingWeek => ({ days });

  it('accepts easy cardio on a football day', () => {
    const violations = validateTrainingWeek(
      week([{ date: '2026-09-02', type: 'cardio', intensity: 'easy', football: true }]),
      RULES,
    );
    expect(violations).toHaveLength(0);
  });

  it('refuses hard intervals on a football day', () => {
    const violations = validateTrainingWeek(
      week([{ date: '2026-09-02', type: 'cardio', intensity: 'hard', football: true }]),
      RULES,
    );
    const violation = violations.find((v) => v.code === 'no_intervals_on_football_day');
    expect(violation).toBeDefined();
    expect(violation!.tier).toBe('never');
    expect(violation!.message).toContain('2026-09-02');
    expect(blocks(violations)).toBe(true);
  });

  it('allows hard intervals on a day with no football', () => {
    const violations = validateTrainingWeek(
      week([{ date: '2026-09-03', type: 'cardio', intensity: 'hard', football: false }]),
      RULES,
    );
    expect(violations).toHaveLength(0);
  });
});

describe('tiers and scoping', () => {
  it('reports soft rules without blocking on them', () => {
    const softOnly: Rule[] = [RULES[4]!];
    const violations = validateMealPlan(dayWith([skyrBreakfast]), softOnly, 'Home');
    expect(blocks(violations)).toBe(false);
  });

  it('ignores deactivated rules', () => {
    const deactivated = RULES.map((rule) => ({ ...rule, active: false }));
    expect(validateMealPlan(dayWith([]), deactivated, 'Home')).toHaveLength(0);
  });

  it('ignores rules with no code — they reach the prompt, not the validator', () => {
    const freeText: Rule[] = [
      { id: 9, tier: 'hard', code: null, scope: null, active: true, text: 'Something Phil typed' },
    ];
    expect(validateMealPlan(dayWith([]), freeText, 'Home')).toHaveLength(0);
  });
});
