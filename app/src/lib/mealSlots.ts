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

/**
 * The slot a meal most likely belongs to, from the hour it is being logged.
 *
 * Every sheet used to open on "snack", so logging lunch at 13:00 took an extra
 * tap that nobody remembered to make — and the day's list said four snacks.
 * A guess from the clock is right most of the time and costs one tap when it
 * is not, which is the trade the whole Food tab is built on.
 */
export function slotForHour(hour: number): MealSlot {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}
