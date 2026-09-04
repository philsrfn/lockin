/**
 * How long a confirmed fridge list is worth planning from.
 *
 * §9 step 3 refuses to plan from an unconfirmed vision pass, because a
 * mis-detected ingredient becomes a meal nobody can cook. A list that was
 * right on Tuesday fails the same way by Saturday — the chicken was the
 * point of Wednesday's dinner and it is gone. Confirmation has a shelf life.
 *
 * Four days is a guess, but it is a stated one: long enough that a weekly shop
 * still counts on Thursday, short enough that the model is not inventing meals
 * out of food that was eaten days ago. The trainer is told the age either way
 * and is expected to say it out loud.
 */

/** Beyond this, a list is not evidence of what is in the fridge. */
export const MAX_INVENTORY_AGE_HOURS = 96;

/** Below this, saying when the list is from would be noise. */
const WORTH_MENTIONING_HOURS = 20;

export type InventoryAge = {
  hours: number;
  /** Too old to plan from at all. */
  stale: boolean;
  /** True when the trainer should say when the list is from before using it. */
  worthMentioning: boolean;
};

export function inventoryAge(capturedAt: Date, now: Date): InventoryAge {
  // A clock skewed backwards — a phone with the wrong time, a row written
  // during a DST shift — would otherwise read as negative and pass every
  // check. Treat the future as brand new rather than as impossibly fresh.
  const hours = Math.max(0, (now.getTime() - capturedAt.getTime()) / 3_600_000);

  return {
    hours: Math.round(hours),
    stale: hours > MAX_INVENTORY_AGE_HOURS,
    worthMentioning: hours >= WORTH_MENTIONING_HOURS,
  };
}
