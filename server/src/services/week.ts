/**
 * The last seven days, one row per day.
 *
 * §4: "weekly targets, not fixed weekdays — travel makes fixed days fail." The
 * programme is weekly, so the home screen is too. This is the shape of that
 * week: what he lifted, whether he stepped on the scale, whether protein
 * landed.
 *
 * Cardio is deliberately absent. There is nowhere to log it yet, and showing a
 * "0 of 2 zone-2" he has no way to satisfy would be inventing a failure.
 */
import type { Ctx } from '../db';
import { addDays, dayIn, daySpanIn, weekdayOf } from '../domain/time';
import { getProfile } from './profile';

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
  proteinG: number;
  kcal: number;
  /** Null when nothing was logged: absent is not the same as zero. */
  proteinPct: number | null;
};

export type Week = {
  days: WeekDay[];
  strength: { done: number; target: number };
  weighIns: { done: number; target: number };
  proteinTargetG: number;
  /** Average over days he actually logged, not over seven. */
  avgProteinG: number | null;
  loggedDays: number;
};

const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export async function getWeek(ctx: Ctx): Promise<Week> {
  const profile = await getProfile(ctx);
  const asOf = dayIn(profile.timezone);
  const firstDay = addDays(asOf, -6);
  const span = daySpanIn(profile.timezone, firstDay, asOf);

  // Timestamps are bucketed into days in his zone. `performed_at::date` would
  // read the database session's timezone instead, and a late session would slide
  // into the wrong column of the strip.
  const [sessions, weights, meals] = await Promise.all([
    ctx.db.query<{ day: string; template: string | null; sets: number }>(
      `select to_char(s.performed_at at time zone $4, 'YYYY-MM-DD') as day,
              max(s.template) as template,
              count(st.id)::int as sets
       from sessions s
       left join sets st on st.session_id = s.id
       where s.user_id = $1 and s.performed_at >= $2 and s.performed_at < $3
         and s.rpe is not null
       group by 1`,
      [ctx.userId, span.from, span.until, profile.timezone],
    ),
    ctx.db.query<{ day: string; weight_kg: number }>(
      `select to_char(measured_on, 'YYYY-MM-DD') as day, weight_kg
       from bodyweight where user_id = $1 and measured_on >= $2::date`,
      [ctx.userId, firstDay],
    ),
    ctx.db.query<{ day: string; protein: number; kcal: number }>(
      `select to_char(eaten_at at time zone $4, 'YYYY-MM-DD') as day,
              coalesce(sum(protein_g), 0)::int as protein,
              coalesce(sum(kcal), 0)::int as kcal
       from meals where user_id = $1 and eaten_at >= $2 and eaten_at < $3
       group by 1`,
      [ctx.userId, span.from, span.until, profile.timezone],
    ),
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
      isToday: date === asOf,
      isFuture: false,
      lifted: !!session,
      template: session?.template ?? null,
      sets: session?.sets ?? 0,
      weightKg: byDayWeight.get(date) ?? null,
      proteinG: protein,
      kcal: meal?.kcal ?? 0,
      proteinPct: meal ? Math.round((protein / profile.proteinTargetG) * 100) : null,
    });
  }

  const logged = days.filter((day) => day.proteinPct !== null);

  return {
    days,
    strength: { done: days.filter((day) => day.lifted).length, target: 3 },
    weighIns: { done: days.filter((day) => day.weightKg !== null).length, target: 7 },
    proteinTargetG: profile.proteinTargetG,
    avgProteinG: logged.length
      ? Math.round(logged.reduce((sum, day) => sum + day.proteinG, 0) / logged.length)
      : null,
    loggedDays: logged.length,
  };
}
