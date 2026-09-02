/**
 * Deloads that arrive before the wheels come off. Pure.
 *
 * There is already a reactive deload in progression.ts: two failed sessions on
 * a movement and the load drops. That is a repair. A programme somebody runs
 * for a year also needs the other kind — a light week that arrives on schedule,
 * while everything still feels fine, because the alternative is finding out
 * later that it was needed three weeks ago.
 *
 * The counter is *weeks in which he trained*, not weeks on the calendar. A
 * fortnight of travel is a deload whether or not the app calls it one, and
 * following it with another would be nonsense.
 */

/** Off when 0. Eight weeks is the middle of the range most programmes use. */
export const DEFAULT_DELOAD_EVERY_WEEKS = 8;

/** How much comes off the bar. Enough to feel light, not enough to detrain. */
export const DELOAD_LOAD_FACTOR = 0.9;

/** One fewer working set, never below one. */
export function deloadSets(sets: number): number {
  return Math.max(1, sets - 1);
}

export type DeloadStatus = {
  /** This week is a light week. */
  active: boolean;
  /** Weeks with training since the last deload. */
  trainingWeeks: number;
  everyWeeks: number;
  /** Due, but not yet recorded. */
  due: boolean;
  /** Said to the athlete once, in the trainer's voice. */
  reason: string | null;
};

export function deloadStatus(input: {
  trainingWeeks: number;
  everyWeeks: number;
  activeThisWeek: boolean;
  /**
   * The block that earned the light week. Recorded when the deload starts,
   * because `trainingWeeks` resets to zero at that moment — reading the live
   * counter produced "you have trained 0 weeks straight".
   */
  earnedAfterWeeks?: number | null;
}): DeloadStatus {
  const everyWeeks = Math.max(0, Math.round(input.everyWeeks));
  const off = everyWeeks === 0;
  const due = !off && !input.activeThisWeek && input.trainingWeeks >= everyWeeks;

  return {
    active: input.activeThisWeek,
    trainingWeeks: input.trainingWeeks,
    everyWeeks,
    due,
    reason: input.activeThisWeek
      ? `Light week. ${Math.round((1 - DELOAD_LOAD_FACTOR) * 100)}% off the bar and a set ` +
        `fewer everywhere — you have trained ${input.earnedAfterWeeks ?? everyWeeks} weeks ` +
        'straight and this is what keeps that going.'
      : null,
  };
}
