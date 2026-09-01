/** The rules document, per §5. Three tiers, editable, scoped to a context. */

export type RuleTier = 'hard' | 'soft' | 'never';

export type Rule = {
  id: number;
  tier: RuleTier;
  text: string;
  /** null = applies everywhere, else a context name like 'Home'. */
  scope: string | null;
  /** Maps to a checker. null = prompt-only, cannot be mechanically enforced. */
  code: string | null;
  active: boolean;
};

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type PlannedMeal = {
  slot: MealSlot;
  description: string;
  kcal: number;
  proteinG: number;
};

export type MealPlanDay = {
  meals: PlannedMeal[];
};

export type TrainingDayType = 'strength' | 'cardio' | 'rest';

export type PlannedTrainingDay = {
  date: string;
  type: TrainingDayType;
  template?: 'A' | 'B' | 'C' | null;
  /** Cardio only. 'hard' means intervals. */
  intensity?: 'easy' | 'hard' | null;
  football?: boolean;
};

export type TrainingWeek = {
  days: PlannedTrainingDay[];
};

export type Violation = {
  ruleId: number;
  tier: RuleTier;
  code: string;
  /** Named specifically, because it is fed back to the model on the re-prompt. */
  message: string;
};

/** hard and never block the output. soft is a preference, reported not enforced. */
export function blocks(violations: Violation[]): boolean {
  return violations.some((violation) => violation.tier === 'hard' || violation.tier === 'never');
}

export function activeRulesFor(rules: Rule[], contextName: string | null): Rule[] {
  return rules.filter(
    (rule) => rule.active && (rule.scope === null || rule.scope === contextName),
  );
}
