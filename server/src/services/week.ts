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
import { type Queryable, pool } from '../db';
import { addDays } from '../domain/trend';
import { getProfile } from './profile';
import { today as todayDate } from './bodyweight';

export type WeekDay = {
  date: string;
  /** Two letters, German — Mo, Di, Mi. The strip is read at a glance. */
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

export async function getWeek(db: Queryable = pool): Promise<Week> {
  const asOf = todayDate();
  const from = addDays(asOf, -6);
  const profile = await getProfile(db);

  const [sessions, weights, meals] = await Promise.all([
    db.query<{ day: string; template: string | null; sets: number }>(
      `select to_char(s.performed_at::date, 'YYYY-MM-DD') as day,
              max(s.template) as template,
              count(st.id)::int as sets
       from sessions s
       left join sets st on st.session_id = s.id
       where s.performed_at::date >= $1::date and s.rpe is not null
       group by 1`,
      [from],
    ),
    db.query<{ day: string; weight_kg: number }>(
      `select to_char(measured_on, 'YYYY-MM-DD') as day, weight_kg
       from bodyweight where measured_on >= $1::date`,
      [from],
    ),
    db.query<{ day: string; protein: number; kcal: number }>(
      `select to_char(eaten_at::date, 'YYYY-MM-DD') as day,
              coalesce(sum(protein_g), 0)::int as protein,
              coalesce(sum(kcal), 0)::int as kcal
       from meals where eaten_at::date >= $1::date
       group by 1`,
      [from],
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
      weekday: WEEKDAYS_DE[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? '',
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
