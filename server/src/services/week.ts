/**
 * The last seven days, one row per day.
 *
 * §4: "weekly targets, not fixed weekdays — travel makes fixed days fail." The
 * programme is weekly, so the home screen is too. This is the shape of that
 * week: what he lifted, whether he stepped on the scale, whether protein
 * landed.
 *
 * Cardio used to be deliberately absent: there was nowhere to log it, and
 * showing a "0 of 2 zone-2" he had no way to satisfy would have been inventing
 * a failure. There is somewhere now, so it counts.
 */
import type { Ctx } from '../db';
import { addDays, dayIn, daySpanIn, weekdayOf } from '../domain/time';
import { WEEKLY_TARGETS } from '../domain/program';
import { cardioByDay } from './cardio';
import { healthByDay } from './health';
import { getProfile } from './profile';
import { finishedSql } from './sessions';

export type WeekDay = {
  date: string;
  /**
   * @deprecated German, and therefore not the client's to trust. The app
   * derives its own label from `date` in the reader's locale. Still sent so
   * the build already on his phone keeps rendering; remove once that is gone.
   */
  weekday: string;
  isToday: boolean;
  isFuture: boolean;
  lifted: boolean;
  template: string | null;
  sets: number;
  weightKg: number | null;
  /** From Apple Health, when the phone has synced. Null means unknown. */
  steps: number | null;
  /** Minutes of cardio, of any kind. */
  cardioMinutes: number;
  /** Sessions that move the weekly tally — a walk to the shops does not. */
  cardioSessions: number;
  proteinG: number;
  kcal: number;
  /** Null when nothing was logged: absent is not the same as zero. */
  proteinPct: number | null;
};

export type Week = {
  days: WeekDay[];
  strength: { done: number; target: number };
  cardio: { done: number; target: number; minutes: number };
  /** §4's 9-10k a day. Averaged over the days that have a number. */
  steps: { average: number | null; target: number; daysKnown: number };
  weighIns: { done: number; target: number };
  proteinTargetG: number;
  /** Average over days he actually logged, not over seven. */
  avgProteinG: number | null;
  loggedDays: number;
};

const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/**
 * `endingOn` is the last day of the window, in the athlete's zone. Defaults to
 * today, which is the home screen; earlier dates are how the strip scrolls
 * back through the weeks behind it.
 */
export async function getWeek(ctx: Ctx, endingOn?: string): Promise<Week> {
  const profile = await getProfile(ctx);
  const today = dayIn(profile.timezone);

  // A window that ends in the future would be seven columns of nothing
  // pretending to be a week.
  const asOf = endingOn && endingOn < today ? endingOn : today;
  const firstDay = addDays(asOf, -6);
  const span = daySpanIn(profile.timezone, firstDay, asOf);

  // Timestamps are bucketed into days in his zone. `performed_at::date` would
  // read the database session's timezone instead, and a late session would slide
  // into the wrong column of the strip.
  const [sessions, weights, meals, cardio, health] = await Promise.all([
    ctx.db.query<{ day: string; template: string | null; sets: number }>(
      `select to_char(s.performed_at at time zone $4, 'YYYY-MM-DD') as day,
              max(s.template) as template,
              count(st.id)::int as sets
       from sessions s
       left join sets st on st.session_id = s.id
       where s.user_id = $1 and s.performed_at >= $2 and s.performed_at < $3
         and ${finishedSql('s')}
       group by 1`,
      [ctx.userId, span.from, span.until, profile.timezone],
    ),
    ctx.db.query<{ day: string; weight_kg: number }>(
      `select to_char(measured_on, 'YYYY-MM-DD') as day, weight_kg
       from bodyweight
       where user_id = $1 and measured_on >= $2::date and measured_on <= $3::date`,
      [ctx.userId, firstDay, asOf],
    ),
    ctx.db.query<{ day: string; protein: number; kcal: number }>(
      `select to_char(eaten_at at time zone $4, 'YYYY-MM-DD') as day,
              coalesce(sum(protein_g), 0)::int as protein,
              coalesce(sum(kcal), 0)::int as kcal
       from meals where user_id = $1 and eaten_at >= $2 and eaten_at < $3
       group by 1`,
      [ctx.userId, span.from, span.until, profile.timezone],
    ),
    cardioByDay(ctx, firstDay, asOf, profile.timezone),
    healthByDay(ctx, firstDay, asOf),
  ]);

  const byDaySession = new Map(sessions.rows.map((row) => [row.day, row]));
  const byDayWeight = new Map(weights.rows.map((row) => [row.day, row.weight_kg]));
  const byDayMeal = new Map(meals.rows.map((row) => [row.day, row]));

  const days: WeekDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = addDays(asOf, -offset);
    const session = byDaySession.get(date);
    const meal = byDayMeal.get(date);
    const protein = meal?.protein ?? 0;

    days.push({
      date,
      weekday: WEEKDAYS_DE[weekdayOf(date)] ?? '',
      isToday: date === today,
      isFuture: date > today,
      lifted: !!session,
      template: session?.template ?? null,
      sets: session?.sets ?? 0,
      weightKg: byDayWeight.get(date) ?? null,
      steps: health.get(date)?.steps ?? null,
      cardioMinutes: cardio.get(date)?.minutes ?? 0,
      cardioSessions: cardio.get(date)?.counted ?? 0,
      proteinG: protein,
      kcal: meal?.kcal ?? 0,
      proteinPct: meal ? Math.round((protein / profile.proteinTargetG) * 100) : null,
    });
  }

  const logged = days.filter((day) => day.proteinPct !== null);

  return {
    days,
    strength: { done: days.filter((day) => day.lifted).length, target: 3 },
    cardio: {
      done: days.reduce((sum, day) => sum + day.cardioSessions, 0),
      target: WEEKLY_TARGETS.zone2Sessions,
      minutes: days.reduce((sum, day) => sum + day.cardioMinutes, 0),
    },
    steps: (() => {
      // Averaged over the days that have a number. A phone that synced on
      // Tuesday should not drag the week down with five zeroes.
      const known = days.filter((day) => day.steps !== null);
      return {
        average: known.length
          ? Math.round(known.reduce((sum, day) => sum + day.steps!, 0) / known.length)
          : null,
        target: WEEKLY_TARGETS.stepsPerDay,
        daysKnown: known.length,
      };
    })(),
    weighIns: { done: days.filter((day) => day.weightKg !== null).length, target: 7 },
    proteinTargetG: profile.proteinTargetG,
    avgProteinG: logged.length
      ? Math.round(logged.reduce((sum, day) => sum + day.proteinG, 0) / logged.length)
      : null,
    loggedDays: logged.length,
  };
}
