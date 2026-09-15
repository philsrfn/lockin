/**
 * The year at a glance: one square per day, dark when nothing happened.
 *
 * The history list answers "what did I do on Tuesday". This answers a
 * different question that the list is bad at — "am I actually showing up" —
 * and it answers it without any judgement attached. A gap is visible without
 * anybody being told off for it, which is the only reason a streak display
 * belongs in an app that is supposed to survive a bad fortnight.
 *
 * Kept as a pure function, away from the component, for the reason §1 keeps
 * arithmetic away from the model: the calendar is full of traps — a month
 * boundary, a week that starts on Monday here and on Sunday elsewhere, a
 * range that begins mid-week — and none of them are testable through a
 * rendered square.
 *
 * Every date here is a calendar day as `YYYY-MM-DD`, never a moment. The
 * arithmetic runs in UTC so that a device in Auckland and one in Lisbon cut
 * the days in the same place; the day strings themselves already came from
 * the athlete's own timezone, decided by the server.
 */

const DAY_MS = 86_400_000;

/**
 * One square. `day` is always a real date — the padding at either end of the
 * grid is `null` instead, so a component can never colour a day that is not
 * in the range and call it a rest day.
 */
export type GridDay = {
  day: string;
  trained: boolean;
};

export type TrainingGrid = {
  /** Columns, oldest first. Each holds seven slots, Monday at the top. */
  weeks: (GridDay | null)[][];
  /** Which column each month label belongs over. */
  months: { column: number; day: string }[];
  trainedDays: number;
  totalDays: number;
};

function toMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday is 0. `getUTCDay` puts Sunday there, which would start the week in the wrong place. */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * @param trained every day that had a session or a cardio entry in it
 * @param today the athlete's today, not the device's
 * @param rangeDays how far back the grid reaches, today included
 */
export function buildTrainingGrid(
  trained: Iterable<string>,
  today: string,
  rangeDays: number,
): TrainingGrid {
  const done = new Set(trained);
  const end = toMs(today);
  const start = end - (rangeDays - 1) * DAY_MS;

  /**
   * The grid starts on the Monday on or before the first day in range, so the
   * rows stay weekdays all the way across. Those leading squares are padding
   * rather than rest days: they fall outside the range the athlete asked for,
   * and showing them grey would claim they did nothing on days nobody looked
   * at.
   */
  const gridStart = start - weekdayIndex(start) * DAY_MS;

  const weeks: (GridDay | null)[][] = [];
  const months: { column: number; day: string }[] = [];
  let trainedDays = 0;
  let totalDays = 0;
  let previousMonth = '';

  for (let cursor = gridStart; cursor <= end; cursor += 7 * DAY_MS) {
    const week: (GridDay | null)[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const ms = cursor + offset * DAY_MS;
      if (ms < start || ms > end) {
        week.push(null);
        continue;
      }
      const day = toIso(ms);
      const wasTrained = done.has(day);
      if (wasTrained) trainedDays += 1;
      totalDays += 1;
      week.push({ day, trained: wasTrained });
    }

    /**
     * A label goes over the column where a new month first appears. Anchored
     * on the column's Monday even when that Monday is padding, because the
     * label names where the eye should land, not a square it can tap.
     */
    const columnStart = toIso(cursor);
    const month = columnStart.slice(0, 7);
    if (month !== previousMonth) {
      months.push({ column: weeks.length, day: columnStart });
      previousMonth = month;
    }

    weeks.push(week);
  }

  return { weeks, months, trainedDays, totalDays };
}

/**
 * The days that had anything in them, from a history payload.
 *
 * Deliberately blind to *what* was done. A run, a session of five squats and
 * ninety minutes of football are one square each — the grid is about
 * attendance, and the History list below it is where the difference lives.
 * A day the server sent with neither a session nor a cardio entry has nothing
 * in it and does not count.
 */
export function trainedDaysFrom(
  days: { day: string; sessions: unknown[]; cardio: unknown[] }[],
): Set<string> {
  const trained = new Set<string>();
  for (const entry of days) {
    if (entry.sessions.length > 0 || entry.cardio.length > 0) trained.add(entry.day);
  }
  return trained;
}
