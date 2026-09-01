/**
 * The checkers behind the rule codes.
 *
 * Rules are free text so they read like Phil wrote them and so he can edit
 * them. A validator cannot interpret arbitrary prose, so each mechanically
 * enforceable rule carries a stable code that lands here. A rule with no code
 * still reaches the model in the system instruction — it simply cannot be
 * enforced, and the app says so.
 *
 * Matching is deliberately generous about language: he is German and will type
 * "Beeren" as often as "berries".
 */
import { MIN_PROTEIN_TARGET_G } from '../domain/safety';
import type { MealPlanDay, TrainingWeek } from './schema';

const has = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const SKYR = [/skyr/i, /magerquark/i];
const BERRIES = [/berr/i, /beeren/i, /heidelbeer/i, /himbeer/i, /erdbeer/i];
const OATS = [/oats?/i, /hafer/i, /porridge/i];

const HALF_PORTION = [/half/i, /halbe/i, /\bhälfte\b/i, /1\/2/];
const PROTEIN_ADD_ON = [/quark/i, /skyr/i, /chicken/i, /hähnchen/i, /shake/i, /protein/i, /tofu/i, /soy/i];

export type MealCheck = (plan: MealPlanDay) => string | null;
export type TrainingCheck = (week: TrainingWeek) => string | null;

/** Returns a message describing the violation, or null when the rule holds. */
export const MEAL_CHECKS: Record<string, MealCheck> = {
  breakfast_skyr(plan) {
    const breakfast = plan.meals.find((meal) => meal.slot === 'breakfast');
    if (!breakfast) {
      return 'The day has no breakfast. Breakfast is always ~500g Skyr with berries and 40g oats.';
    }

    const missing: string[] = [];
    if (!has(breakfast.description, SKYR)) missing.push('Skyr');
    if (!has(breakfast.description, BERRIES)) missing.push('berries');
    if (!has(breakfast.description, OATS)) missing.push('oats');

    return missing.length === 0
      ? null
      : `Breakfast "${breakfast.description}" is missing ${missing.join(' and ')}. ` +
          'Breakfast is always ~500g Skyr with berries and 40g oats, no substitutions.';
  },

  home_dinner_moms_food(plan) {
    const dinner = plan.meals.find((meal) => meal.slot === 'dinner');
    if (!dinner) return null; // Skipping dinner is not this rule's business.

    const halved = has(dinner.description, HALF_PORTION);
    const topped = has(dinner.description, PROTEIN_ADD_ON);
    if (halved && topped) return null;

    const missing: string[] = [];
    if (!halved) missing.push('it is not half a portion');
    if (!topped) missing.push('there is no protein add-on');

    return (
      `Dinner "${dinner.description}" breaks the Home rule: ${missing.join(' and ')}. ` +
      "At Home, dinner is half a portion of mom's food plus a protein add-on " +
      '(200g Magerquark, chicken breast, or a shake).'
    );
  },

  min_daily_protein(plan) {
    const total = plan.meals.reduce((sum, meal) => sum + (meal.proteinG || 0), 0);
    return total >= MIN_PROTEIN_TARGET_G
      ? null
      : `The day totals ${Math.round(total)}g protein. Never propose a day under ${MIN_PROTEIN_TARGET_G}g.`;
  },
};

export const TRAINING_CHECKS: Record<string, TrainingCheck> = {
  no_intervals_on_football_day(week) {
    const clash = week.days.find((day) => day.football && day.intensity === 'hard');
    return clash
      ? `${clash.date} has football and hard intervals. Never schedule hard intervals on a football day.`
      : null;
  },
};
