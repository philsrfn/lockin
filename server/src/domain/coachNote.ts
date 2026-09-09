/**
 * Whether the note written earlier today still describes today.
 *
 * The coach's read is cached per day on purpose (§11): regenerating it on
 * every app open would let it drift, so that the same morning gives different
 * advice depending on how often you looked. The cost of caching is that the
 * world can move underneath it, and two things move often enough to matter.
 *
 * Pure, and separate from the note itself, because this is the decision that
 * has been quietly wrong: the context check has been here since the beginning
 * and the programme check has not, so a note could name a session the athlete
 * was no longer running and the card and the plan below it disagreed.
 */

export type CachedNote = {
  /** The day of the programme it named. Null on a rest day. */
  template: string | null;
  /** The place it was written for. */
  contextName: string | null;
};

export type NoteWorld = {
  contextName: string | null;
  /** Every day code the current programme has. */
  dayCodes: readonly string[];
};

export function noteStillFits(cached: CachedNote, world: NoteWorld): boolean {
  // A different city is a different gym and different food rules.
  if (cached.contextName !== world.contextName) return false;

  // A rest day stays a rest day whichever programme it is a rest from.
  if (cached.template === null) return true;

  // Otherwise it named a session, and the session has to still exist. After a
  // programme switch it frequently does not — and a note saying "Einheit B"
  // above a plan saying "Push" is the app disagreeing with itself about the
  // one thing the screen is for.
  return world.dayCodes.includes(cached.template);
}
