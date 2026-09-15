import type { MealSlot } from '../api/types';
import type { PhraseKey } from './locale';

/**
 * The four meal slots, in the order a day has them, and what to call each.
 *
 * `FoodCapture` had this map and the Food tab did not, so every meal logged
 * today showed its slot as the raw database value — "Breakfast" on a German
 * screen, under a German meal. One map for both, so the next screen that shows
 * a slot has nowhere else to copy it from.
 */
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const LABELS: Record<MealSlot, PhraseKey> = {
  breakfast: 'slotBreakfast',
  lunch: 'slotLunch',
  dinner: 'slotDinner',
  snack: 'slotSnack',
};

export const slotLabelKey = (slot: MealSlot): PhraseKey => LABELS[slot];
