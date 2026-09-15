/**
 * When a workout left open on this phone stops being one.
 *
 * The server has answered this since `server/src/domain/session.ts`: six hours
 * after it started, a session with sets counts as finished and one without is
 * a false start. The phone never asked. `openLocalSession()` returns any
 * unfinished row however old it is, so a session started on Monday and never
 * closed was still "in progress" on Thursday — Start reopened it, and new sets
 * went into a session dated three days earlier that the server had long since
 * stopped treating as live.
 *
 * Duplicated rather than fetched, because the logger has to decide this with
 * no signal. The number is the server's; a test pins the two together.
 */
export const SESSION_LIVE_HOURS = 6;

const HOUR_MS = 3_600_000;

export function isAbandoned(performedAt: string, now: Date = new Date()): boolean {
  const started = Date.parse(performedAt);
  // An unreadable date keeps today's behaviour — open — rather than closing a
  // session somebody may be halfway through on the strength of a parse error.
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= SESSION_LIVE_HOURS * HOUR_MS;
}
