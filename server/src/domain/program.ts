/**
 * What a training programme is, and how its days rotate. Pure.
 *
 * Three full-body days were hardcoded here, because there was one athlete and
 * that was his programme. The programmes now live in the database — a short
 * catalogue, chosen once — because three full-body days is the wrong shape for
 * somebody who can train four or five times a week.
 *
 * §14 still stands: this is not a program builder. What remains here is the
 * arithmetic that belongs to no particular programme.
 */

import { DEFAULT_REP_RANGE, type RepRange } from './progression';

export { DEFAULT_REP_RANGE };
export type { RepRange };

/**
 * A day's identifier, stored on `sessions.template`: 'A', 'U1', 'Push'. It is
 * history as much as configuration — changing one would orphan every session
 * already logged against it.
 */
export type DayCode = string;

/**
 * A → B → C → A, off the last day he logged. Rotation rather than a weekday
 * schedule, because travel breaks weekday schedules — and a programme that
 * waits for Tuesday is a programme you fall off.
 */
export function nextInRotation(codes: readonly DayCode[], last: DayCode | null): DayCode | null {
  if (codes.length === 0) return null;
  if (!last) return codes[0]!;

  const index = codes.indexOf(last);
  // A code this programme does not contain means he switched programmes since
  // that session. Start the new rotation at the top rather than guessing.
  return index === -1 ? codes[0]! : codes[(index + 1) % codes.length]!;
}

/**
 * Sensible defaults for an exercise the programme does not name — the
 * substitute he reaches for when a machine is occupied, or when the gym in
 * this city does not have it.
 */
export function defaultsForPattern(pattern: string): {
  incrementKg: number;
  restSeconds: number;
  range: RepRange;
} {
  switch (pattern) {
    case 'squat':
    case 'hinge':
      return { incrementKg: 2.5, restSeconds: 180, range: DEFAULT_REP_RANGE };
    case 'h_push':
    case 'v_push':
    case 'h_pull':
    case 'v_pull':
      return { incrementKg: 2.5, restSeconds: 150, range: DEFAULT_REP_RANGE };
    default:
      // Isolation moves in half jumps and rests short.
      return { incrementKg: 1.25, restSeconds: 60, range: DEFAULT_REP_RANGE };
  }
}

/** §4: weekly targets, not fixed weekdays. */
export const WEEKLY_TARGETS = {
  strengthSessions: 3,
  zone2Sessions: 2,
  zone2Minutes: 35,
  stepsPerDay: 9500,
} as const;
