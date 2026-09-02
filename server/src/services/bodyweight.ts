import type { Ctx } from '../db';
import { badRequest } from '../errors';
import { addDays, dayIn } from '../domain/time';
import { athleteZone } from './clock';
import {
  type MovingAverage,
  type TrendPoint,
  type WeightEntry,
  movingAverage,
  trendSeries,
  weeklyChangeKg,
} from '../domain/trend';

/** Sanity bounds. A slipped decimal point should not become a data point. */
const MIN_PLAUSIBLE_KG = 30;
const MAX_PLAUSIBLE_KG = 300;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WeightSummary = {
  latest: WeightEntry | null;
  average7: MovingAverage | null;
  /** This week's average minus last week's. Negative is loss. */
  changeKg: number | null;
  goalWeightKg: number | null;
  series: TrendPoint[];
};

export async function listEntries(
  ctx: Ctx,
  days: number,
  zone?: string,
): Promise<WeightEntry[]> {
  // Counted from his today, not the database server's. `measured_on` is a bare
  // date, so the window is calendar arithmetic rather than an interval.
  const asOf = dayIn(zone ?? (await athleteZone(ctx)));
  const { rows } = await ctx.db.query<{ measured_on: string; weight_kg: number }>(
    `select measured_on, weight_kg
     from bodyweight
     where user_id = $1 and measured_on >= $2::date
     order by measured_on`,
    [ctx.userId, addDays(asOf, -days)],
  );
  return rows.map((row) => ({ measuredOn: row.measured_on, weightKg: row.weight_kg }));
}

export async function summary(ctx: Ctx, days = 30, zone?: string): Promise<WeightSummary> {
  const timezone = zone ?? (await athleteZone(ctx));
  // Reach back an extra fortnight so the oldest points in the series still have
  // a full window behind them, and so week-over-week has a prior week to use.
  const entries = await listEntries(ctx, days + 14, timezone);
  const asOf = dayIn(timezone);

  const { rows } = await ctx.db.query<{ goal_weight_kg: number | null }>(
    'select goal_weight_kg from profile where user_id = $1',
    [ctx.userId],
  );

  const latest = entries.length > 0 ? entries[entries.length - 1]! : null;

  return {
    latest,
    average7: movingAverage(entries, asOf),
    changeKg: weeklyChangeKg(entries, asOf),
    goalWeightKg: rows[0]?.goal_weight_kg ?? null,
    series: trendSeries(entries, asOf, days),
  };
}

export type LogWeightInput = {
  measuredOn?: string;
  weightKg: number;
};

/**
 * One weigh-in per day, upserted — stepping on the scale twice replaces the
 * morning number rather than skewing the average with a duplicate.
 */
export async function logWeight(
  ctx: Ctx,
  input: LogWeightInput,
  zone?: string,
): Promise<{ entry: WeightEntry; summary: WeightSummary }> {
  const timezone = zone ?? (await athleteZone(ctx));
  const measuredOn = input.measuredOn ?? dayIn(timezone);

  if (!ISO_DATE.test(measuredOn)) {
    throw badRequest('measuredOn must be YYYY-MM-DD');
  }
  if (!Number.isFinite(input.weightKg)) {
    throw badRequest('weightKg must be a number');
  }
  if (input.weightKg < MIN_PLAUSIBLE_KG || input.weightKg > MAX_PLAUSIBLE_KG) {
    throw badRequest(`weightKg must be between ${MIN_PLAUSIBLE_KG} and ${MAX_PLAUSIBLE_KG}`);
  }

  const { rows } = await ctx.db.query<{ measured_on: string; weight_kg: number }>(
    `insert into bodyweight (user_id, measured_on, weight_kg)
     values ($1, $2, $3)
     on conflict (user_id, measured_on) do update set weight_kg = excluded.weight_kg
     returning measured_on, weight_kg`,
    [ctx.userId, measuredOn, input.weightKg],
  );

  const row = rows[0]!;
  return {
    entry: { measuredOn: row.measured_on, weightKg: row.weight_kg },
    summary: await summary(ctx, 30, timezone),
  };
}
