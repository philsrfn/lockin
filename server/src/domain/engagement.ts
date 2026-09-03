/**
 * Whether somebody is still here. Pure.
 *
 * The expensive half of the morning check-in is the coaching note — a model
 * call, made before anyone has opened anything. The cheap half is the
 * notification. They stop at different points, because they cost different
 * things and because a push might still bring somebody back where a note they
 * will never read cannot.
 */

/** After this, stop paying a model to write to somebody who is not reading. */
export const QUIET_AFTER_DAYS = 4;

/**
 * After this, stop pushing altogether. Someone who has ignored a fortnight of
 * notifications is not going to be won back by the fifteenth, and an app that
 * keeps tapping the shoulder of somebody who left is one they delete rather
 * than ignore.
 */
export const SILENT_AFTER_DAYS = 14;

export type Engagement = {
  /** null when the app has never recorded an opening. */
  daysAway: number | null;
  /** Ask the model for today's note. */
  writeCoachNote: boolean;
  /** Send anything at all. */
  push: boolean;
};

export function engagement(lastSeenAt: Date | null, now: Date = new Date()): Engagement {
  // Never measured — a brand-new athlete, or one who predates this column.
  // Coach them: being wrong towards "still here" costs one model call, being
  // wrong the other way silently abandons somebody.
  if (!lastSeenAt) {
    return { daysAway: null, writeCoachNote: true, push: true };
  }

  const daysAway = Math.max(0, Math.floor((now.getTime() - lastSeenAt.getTime()) / 86_400_000));

  return {
    daysAway,
    writeCoachNote: daysAway < QUIET_AFTER_DAYS,
    push: daysAway < SILENT_AFTER_DAYS,
  };
}
