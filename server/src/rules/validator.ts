/**
 * §5: "validateAgainstRules(plan, rules) runs on every generated meal plan and
 * training week. On violation: do not surface the output. Re-prompt once with
 * the specific violation named. On second failure, fall back to the
 * deterministic template and log it."
 *
 * This module is the first half of that: it finds violations and names them
 * precisely enough to re-prompt with. The retry loop lives in llm/generate.ts.
 *
 * Pure. No database, no model.
 */
import { type CheckLimits, DEFAULT_LIMITS, MEAL_CHECKS, TRAINING_CHECKS } from './checks';
import { type MealPlanDay, type Rule, type TrainingWeek, type Violation, activeRulesFor } from './schema';

function run<T>(
  subject: T,
  rules: Rule[],
  checks: Record<string, (subject: T, limits: CheckLimits) => string | null>,
  limits: CheckLimits,
): Violation[] {
  const violations: Violation[] = [];

  for (const rule of rules) {
    // No code means no checker: the rule reaches the model in the system
    // instruction but cannot be mechanically enforced.
    if (!rule.code) continue;

    const check = checks[rule.code];
    if (!check) continue;

    const message = check(subject, limits);
    if (message) {
      violations.push({ ruleId: rule.id, tier: rule.tier, code: rule.code, message });
    }
  }

  return violations;
}

export function validateMealPlan(
  plan: MealPlanDay,
  rules: Rule[],
  contextName: string | null,
  limits: CheckLimits = DEFAULT_LIMITS,
): Violation[] {
  return run(plan, activeRulesFor(rules, contextName), MEAL_CHECKS, limits);
}

export function validateTrainingWeek(
  week: TrainingWeek,
  rules: Rule[],
  contextName: string | null = null,
  limits: CheckLimits = DEFAULT_LIMITS,
): Violation[] {
  return run(week, activeRulesFor(rules, contextName), TRAINING_CHECKS, limits);
}

/** The sentence handed back to the model on the single retry §5 allows. */
export function reprompt(violations: Violation[]): string {
  return (
    'That output broke rules you must follow. Fix exactly these and return the ' +
    'whole thing again:\n' +
    violations.map((violation) => `- ${violation.message}`).join('\n')
  );
}
