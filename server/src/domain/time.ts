/**
 * Calendar arithmetic in a named timezone. Pure.
 *
 * "Today" is the most load-bearing word in this app. It decides which meals
 * count towards the macros on the home screen, which day of the week strip a
 * session lands on, whether the morning check-in has already run, and what date
 * the weekly review is filed under.
 *
 * It used to mean "today in Europe/Berlin", assumed in two different ways at
 * once: `new Date().toLocaleDateString('sv-SE')` against a container pinned to
 * TZ=Europe/Berlin, and Postgres `current_date` against the session timezone.
 * For one athlete in Berlin both are right. For anyone else the day rolls over
 * at the wrong hour and a dinner logged at 9pm lands on tomorrow.
 *
 * So: one zone, carried explicitly, and every "today" in the codebase computed
 * here. Days are 'YYYY-MM-DD' strings — they sort, they survive JSON, and no
 * timezone can shift them backwards into yesterday.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

/**
 * Cached because a DateTimeFormat costs about as much to build as the work it
 * then does, and the scheduler asks for the same zone once a minute forever.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let cached = formatters.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, cached);
  }
  return cached;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** What a wall clock in `zone` reads at `instant`. */
function wallClock(zone: string, instant: Date): Wall {
  const parts = formatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Intl gives midnight as hour 24 in some engines when hour12 is false.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** The calendar date at `instant` in `zone`, as 'YYYY-MM-DD'. */
export function dayIn(zone: string, instant: Date = new Date()): string {
  const wall = wallClock(zone, instant);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** Minutes since local midnight. What the scheduler compares its times against. */
export function minutesOfDayIn(zone: string, instant: Date = new Date()): number {
  const wall = wallClock(zone, instant);
  return wall.hour * 60 + wall.minute;
}

/** How far `zone` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(zone: string, instant: Date): number {
  const wall = wallClock(zone, instant);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Milliseconds are dropped by the formatter; put them back so the offset is
  // exact and a round trip does not lose sub-second precision.
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

export function assertIsoDay(day: string): void {
  if (!ISO_DATE.test(day)) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
}

/**
 * The instant at which `day` begins in `zone`.
 *
 * Two passes: the offset depends on the instant, and the instant depends on the
 * offset. Guessing with UTC's offset and correcting once with the offset that
 * actually applies there settles every case except a zone whose clocks shift
 * across midnight itself — where local midnight does not exist and the correct
 * answer is the first instant of the day, which is what the guard returns.
 */
export function startOfDayIn(zone: string, day: string): Date {
  assertIsoDay(day);
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, date);

  let instant = new Date(naive - offsetMs(zone, new Date(naive)));
  instant = new Date(naive - offsetMs(zone, instant));

  // Spring-forward across midnight: the requested wall time never happens, and
  // the estimate lands on the previous day. Step to when the day does start.
  if (dayIn(zone, instant) !== day) {
    for (let minutes = 1; minutes <= 24 * 60; minutes += 1) {
      const stepped = new Date(instant.getTime() + minutes * 60_000);
      if (dayIn(zone, stepped) === day) return stepped;
    }
  }

  return instant;
}

/** Shift a 'YYYY-MM-DD' by whole days. Calendar arithmetic, no clock involved. */
export function addDays(day: string, days: number): string {
  assertIsoDay(day);
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * Day of week for a calendar date: 0 = Sunday, matching `Date#getDay`. Computed
 * from the date string at noon UTC, so no zone can nudge it into the day next
 * door.
 */
export function weekdayOf(day: string): number {
  assertIsoDay(day);
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export type DayRange = {
  /** Inclusive. */
  from: Date;
  /** Exclusive — the instant the following day begins. */
  until: Date;
};

/**
 * Half-open bounds for one local day, for `where t >= from and t < until`.
 * Half-open rather than inclusive on both ends because a meal logged at
 * 23:59:59.7 is still that day's dinner.
 */
export function dayRangeIn(zone: string, day: string): DayRange {
  return { from: startOfDayIn(zone, day), until: startOfDayIn(zone, addDays(day, 1)) };
}

/** Bounds spanning `from` through `to` inclusive, as local days. */
export function daySpanIn(zone: string, from: string, to: string): DayRange {
  return { from: startOfDayIn(zone, from), until: startOfDayIn(zone, addDays(to, 1)) };
}

/**
 * The last `days` local days ending today — the window behind the week strip
 * and the trend. `days` counts the days shown, so 7 is today plus the six
 * before it.
 */
export function trailingDaysIn(
  zone: string,
  days: number,
  now: Date = new Date(),
): DayRange & { firstDay: string; lastDay: string } {
  const lastDay = dayIn(zone, now);
  const firstDay = addDays(lastDay, -(days - 1));
  return { ...daySpanIn(zone, firstDay, lastDay), firstDay, lastDay };
}
