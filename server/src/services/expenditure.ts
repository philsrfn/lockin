/**
 * What the athlete actually burns, read out of what they have already logged.
 *
 * The arithmetic and — more importantly — the refusals live in
 * `domain/expenditure.ts`. This assembles the two inputs: intake per day, and
 * every weigh-in in the window plus the week before it, because the estimate
 * smooths both ends.
 */
import type { Ctx } from '../db';
import {
  DEFAULT_WINDOW_DAYS,
  type ExpenditureResult,
  type IntakeDay,
  estimateExpenditure,
} from '../domain/expenditure';
import { type WeightEntry } from '../domain/trend';
import { addDays, dayIn, daySpanIn } from '../domain/time';
import { athleteZone } from './clock';

/** Total kcal per day of the athlete's, across a span of their days. */
async function intakeByDay(
  ctx: Ctx,
  firstDay: string,
  lastDay: string,
  zone: string,
): Promise<IntakeDay[]> {
  const span = daySpanIn(zone, firstDay, lastDay);

  const { rows } = await ctx.db.query<{ day: string; kcal: number }>(
    `select to_char(eaten_at at time zone $4, 'YYYY-MM-DD') as day,
            coalesce(sum(kcal), 0)::int as kcal
     from meals
     where user_id = $1 and eaten_at >= $2 and eaten_at < $3
     group by 1`,
    [ctx.userId, span.from, span.until, zone],
  );

  return rows;
}

export async function expenditure(
  ctx: Ctx,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ExpenditureResult> {
  const zone = await athleteZone(ctx);
  const asOf = dayIn(zone);
  const firstDay = addDays(asOf, -(windowDays - 1));

  const [intake, weights] = await Promise.all([
    intakeByDay(ctx, firstDay, asOf, zone),
    // A fortnight before the window opens: the opening average looks back
    // seven days from the day before the window, and asking for a little more
    // than that costs nothing and spares an off-by-one.
    weighInsSince(ctx, addDays(firstDay, -14)),
  ]);

  return estimateExpenditure(intake, weights, asOf, windowDays);
}

async function weighInsSince(ctx: Ctx, from: string): Promise<WeightEntry[]> {
  const { rows } = await ctx.db.query<{ measured_on: string; weight_kg: number }>(
    `select to_char(measured_on, 'YYYY-MM-DD') as measured_on, weight_kg
     from bodyweight
     where user_id = $1 and measured_on >= $2
     order by measured_on`,
    [ctx.userId, from],
  );

  return rows.map((row) => ({ measuredOn: row.measured_on, weightKg: row.weight_kg }));
}
