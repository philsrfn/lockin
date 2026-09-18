/**
 * When the weekly photograph is due.
 *
 * Pure calendar arithmetic, and the one place that decides it — the job uses
 * it to know whether to knock, and the screen is told the answer rather than
 * working it out again from the same dates in a different timezone.
 */

const DAY_MS = 86_400_000;

/**
 * Not seven days, six.
 *
 * The push fires on a Sunday morning. Somebody who took last week's photo on
 * Sunday and this week's on Sunday is exactly seven days apart, but somebody
 * who took it on Monday because they slept in would be six — and telling them
 * "not yet" on the day the notification arrived is the kind of small refusal
 * that ends a habit. The check-in is weekly by intent, not by stopwatch.
 */
export const MIN_DAYS_BETWEEN = 6;

/**
 * How many photographs may go into one check-in.
 *
 * Four: this week's and three behind it. Enough to see a direction rather
 * than a single step — one comparison is noise, three is a line — and few
 * enough that the upload still finishes on a phone network and the model
 * still reads them all properly. The phone chooses which ones to send,
 * because the phone is the only place they exist; this is the ceiling it is
 * held to.
 */
export const MAX_PHOTOS = 4;

function daysBetween(from: string, to: string): number {
  const at = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((at(to) - at(from)) / DAY_MS);
}

/**
 * @param lastTakenOn the day of the most recent check-in, or null for none
 * @param today the athlete's today
 */
export function checkinDue(lastTakenOn: string | null, today: string): boolean {
  if (lastTakenOn === null) return true;
  return daysBetween(lastTakenOn, today) >= MIN_DAYS_BETWEEN;
}

/**
 * The days since the last one, so the screen can say so in words.
 * Null when there has not been one.
 */
export function daysSinceCheckin(lastTakenOn: string | null, today: string): number | null {
  if (lastTakenOn === null) return null;
  return daysBetween(lastTakenOn, today);
}
