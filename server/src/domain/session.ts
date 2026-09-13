/**
 * When a session stops being in progress.
 *
 * Pressing finish records an RPE, and that was the only way a session ever
 * ended. Nothing else closed one — so a session started and walked away from
 * stayed open indefinitely, and two things followed from that.
 *
 * The visible one is cosmetic: Today's primary action reads "resume" forever,
 * and the rotation stays pinned to that day because `templateForToday`
 * follows an open session.
 *
 * The one that costs something is quieter. "Finished" gates progression
 * history, the weekly targets, the joint-pain streak and the Sunday review —
 * so a session with real sets in it that nobody closed is invisible to all
 * four. The work happened, the loads went up, and the app cannot see it.
 * Walking out of a gym without opening the app again is not an unusual thing
 * to do; it should not cost somebody their session.
 *
 * So a session ends either when the athlete says so or when it plainly is no
 * longer happening, and what it counts as then depends on whether anything
 * was logged:
 *
 *   sets logged  → it happened. Finished, with no RPE — an RPE nobody gave is
 *                  a number invented about how hard something felt, which is
 *                  worse than an absent one.
 *   nothing      → a false start. Start pressed, phone pocketed, and it should
 *                  leave no trace in a training history.
 *
 * Read-time only. Nothing is written, no migration, and every row already in
 * the database is reinterpreted the moment this ships.
 */

/**
 * How long a session stays live.
 *
 * Six hours rather than a calendar day: a session is over long before
 * midnight, and an athlete who trains at 18:00 should not see "resume" at
 * bedtime. Longer than any real session — the longest anybody trains is about
 * three hours — so the window never closes one that is still going.
 *
 * A duration, not a date, which is why it can be measured against the
 * server's clock. "Today" belongs to the athlete (see `services/clock.ts`);
 * six hours is six hours in every zone.
 */
export const SESSION_LIVE_HOURS = 6;

export type SessionState =
  /** Still in progress. */
  | 'live'
  /** Over, whether or not anybody pressed the button. */
  | 'finished'
  /** Started, nothing logged, abandoned. Not a session that happened. */
  | 'false_start';

export function sessionState(
  session: { performedAt: Date; rpe: number | null; setCount: number },
  now: Date = new Date(),
): SessionState {
  // Pressing finish ends it whatever the clock says, including a session
  // logged retroactively with a date in the past.
  if (session.rpe !== null) return 'finished';

  const hours = (now.getTime() - session.performedAt.getTime()) / 3_600_000;
  if (hours < SESSION_LIVE_HOURS) return 'live';

  return session.setCount > 0 ? 'finished' : 'false_start';
}

/** What the app means by "this one happened", for counting and progression. */
export const didHappen = (state: SessionState): boolean => state === 'finished';
