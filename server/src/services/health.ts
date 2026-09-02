/**
 * What the phone already knows.
 *
 * Logging fatigue is the main reason fitness apps are deleted in week three,
 * and the antidote is not a better logger — it is not having to log. Steps,
 * sleep, resting heart rate and a smart scale are all sitting in Apple Health
 * already, and the coach has been asking about the two of them that matter for
 * recovery because it had no other way to know.
 *
 * A sync is partial and repeatable by design: the phone syncs a window on every
 * foreground, so the same day arrives many times and the same workout must not
 * be counted twice.
 */
import type { Ctx } from '../db';
import { addDays, dayIn, daySpanIn } from '../domain/time';
import { badRequest } from '../errors';
import { athleteZone } from './clock';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HealthDay = {
  day: string;
  steps?: number | null;
  sleepMinutes?: number | null;
  restingHr?: number | null;
  activeKcal?: number | null;
};

export type HealthWorkout = {
  /** HealthKit's uuid. The dedupe key — a sync that runs twice must not double-count. */
  externalId: string;
  startedAt: string;
  minutes: number;
  /** Mapped on the phone, where the HealthKit activity type is known. */
  kind: 'zone2' | 'intervals' | 'sport' | 'walk' | 'other';
  description?: string | null;
  distanceKm?: number | null;
  avgHr?: number | null;
};

export type HealthWeight = {
  measuredOn: string;
  weightKg: number;
};

export type SyncPayload = {
  days?: HealthDay[];
  workouts?: HealthWorkout[];
  weights?: HealthWeight[];
};

export type SyncResult = {
  days: number;
  workouts: { imported: number; alreadyHad: number };
  weights: { imported: number; keptHisOwn: number };
};

/** A batch of thirty days must not fail because one of them is nonsense. */
const inRange = (value: number | null | undefined, min: number, max: number) =>
  value == null ? null : Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value)
    : null;

const MAX_DAYS = 400;
const MAX_WORKOUTS = 500;
const MAX_WEIGHTS = 400;

/**
 * Idempotent throughout. The phone does not track what it has already sent —
 * it sends a window and lets the server work it out, because a phone that has
 * to remember is a phone that loses a week when it is reinstalled.
 */
export async function syncHealth(ctx: Ctx, payload: SyncPayload): Promise<SyncResult> {
  const days = payload.days ?? [];
  const workouts = payload.workouts ?? [];
  const weights = payload.weights ?? [];

  if (days.length > MAX_DAYS || workouts.length > MAX_WORKOUTS || weights.length > MAX_WEIGHTS) {
    throw badRequest('That is more history than one sync should carry');
  }

  const result: SyncResult = {
    days: 0,
    workouts: { imported: 0, alreadyHad: 0 },
    weights: { imported: 0, keptHisOwn: 0 },
  };

  for (const entry of days) {
    if (!ISO_DATE.test(entry.day)) continue;

    const steps = inRange(entry.steps, 0, 200_000);
    const sleep = inRange(entry.sleepMinutes, 0, 1440);
    const restingHr = inRange(entry.restingHr, 25, 200);
    const activeKcal = inRange(entry.activeKcal, 0, 20_000);
    if (steps === null && sleep === null && restingHr === null && activeKcal === null) continue;

    await ctx.db.query(
      `insert into daily_health (user_id, day, steps, sleep_minutes, resting_hr, active_kcal)
       values ($1, $2::date, $3, $4, $5, $6)
       on conflict (user_id, day) do update set
         -- coalesce, not overwrite: a sync that has steps but no sleep yet must
         -- not erase last night's sleep.
         steps         = coalesce(excluded.steps, daily_health.steps),
         sleep_minutes = coalesce(excluded.sleep_minutes, daily_health.sleep_minutes),
         resting_hr    = coalesce(excluded.resting_hr, daily_health.resting_hr),
         active_kcal   = coalesce(excluded.active_kcal, daily_health.active_kcal),
         updated_at    = now()`,
      [ctx.userId, entry.day, steps, sleep, restingHr, activeKcal],
    );
    result.days += 1;
  }

  for (const workout of workouts) {
    if (!workout.externalId || !Number.isFinite(workout.minutes)) continue;
    const minutes = inRange(workout.minutes, 1, 600);
    if (minutes === null) continue;

    const { rowCount } = await ctx.db.query(
      `insert into cardio_sessions
         (user_id, performed_at, kind, minutes, description, distance_km, avg_hr,
          source, external_id)
       values ($1, $2::timestamptz, $3, $4, $5, $6, $7, 'health', $8)
       on conflict (user_id, external_id) where external_id is not null do nothing`,
      [
        ctx.userId,
        workout.startedAt,
        workout.kind,
        minutes,
        workout.description?.trim() || null,
        workout.distanceKm ?? null,
        inRange(workout.avgHr, 30, 240),
        workout.externalId,
      ],
    );

    if (rowCount) result.workouts.imported += 1;
    else result.workouts.alreadyHad += 1;
  }

  for (const weight of weights) {
    if (!ISO_DATE.test(weight.measuredOn)) continue;
    const kg = weight.weightKg;
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) continue;

    // A number he typed beats one that arrived from a scale. Imports only fill
    // a gap or update a previous import.
    const { rowCount } = await ctx.db.query(
      `insert into bodyweight (user_id, measured_on, weight_kg, source)
       values ($1, $2::date, $3, 'health')
       on conflict (user_id, measured_on) do update
         set weight_kg = excluded.weight_kg
         where bodyweight.source = 'health'`,
      [ctx.userId, weight.measuredOn, kg],
    );

    if (rowCount) result.weights.imported += 1;
    else result.weights.keptHisOwn += 1;
  }

  return result;
}

export type DailyHealth = {
  day: string;
  steps: number | null;
  sleepMinutes: number | null;
  restingHr: number | null;
  activeKcal: number | null;
};

type Row = {
  day: string;
  steps: number | null;
  sleep_minutes: number | null;
  resting_hr: number | null;
  active_kcal: number | null;
};

const toDaily = (row: Row): DailyHealth => ({
  day: row.day,
  steps: row.steps,
  sleepMinutes: row.sleep_minutes,
  restingHr: row.resting_hr,
  activeKcal: row.active_kcal,
});

const SELECT = `
  select to_char(day, 'YYYY-MM-DD') as day, steps, sleep_minutes, resting_hr, active_kcal
  from daily_health
  where user_id = $1
`;

/** Keyed by date, for the week strip. */
export async function healthByDay(
  ctx: Ctx,
  firstDay: string,
  lastDay: string,
): Promise<Map<string, DailyHealth>> {
  const { rows } = await ctx.db.query<Row>(
    `${SELECT} and day >= $2::date and day <= $3::date order by day`,
    [ctx.userId, firstDay, lastDay],
  );
  return new Map(rows.map((row) => [row.day, toDaily(row)]));
}

export async function healthToday(ctx: Ctx, zone?: string): Promise<DailyHealth | null> {
  const day = dayIn(zone ?? (await athleteZone(ctx)));
  const { rows } = await ctx.db.query<Row>(`${SELECT} and day = $2::date`, [ctx.userId, day]);
  return rows[0] ? toDaily(rows[0]) : null;
}

export type RecoverySignals = {
  /** Averaged over the days that have a number, not over the window. */
  avgSteps: number | null;
  daysWithSteps: number;
  lastNightSleepMinutes: number | null;
  restingHr: number | null;
  /** Change in resting heart rate against the fortnight before. Up is worse. */
  restingHrTrend: number | null;
};

/**
 * What the coach reads instead of asking. Resting heart rate drifting up over
 * a block is the signal that arrives before somebody feels it, which is the
 * whole reason to have it.
 */
export async function recoverySignals(
  ctx: Ctx,
  zone?: string,
  days = 14,
): Promise<RecoverySignals> {
  const timezone = zone ?? (await athleteZone(ctx));
  const today = dayIn(timezone);
  const recent = await healthByDay(ctx, addDays(today, -(days - 1)), today);

  const stepDays = [...recent.values()].filter((day) => day.steps != null);
  const hrDays = [...recent.values()].filter((day) => day.restingHr != null);

  const priorFrom = addDays(today, -(days * 2 - 1));
  const prior = await healthByDay(ctx, priorFrom, addDays(today, -days));
  const priorHr = [...prior.values()].filter((day) => day.restingHr != null);

  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  const currentHr = mean(hrDays.map((day) => day.restingHr!));
  const beforeHr = mean(priorHr.map((day) => day.restingHr!));

  // Yesterday's sleep: last night's is recorded against the day he woke up.
  const lastNight = recent.get(today) ?? recent.get(addDays(today, -1)) ?? null;

  return {
    avgSteps: stepDays.length ? Math.round(mean(stepDays.map((day) => day.steps!))!) : null,
    daysWithSteps: stepDays.length,
    lastNightSleepMinutes: lastNight?.sleepMinutes ?? null,
    restingHr: hrDays.length ? Math.round(currentHr!) : null,
    restingHrTrend:
      currentHr != null && beforeHr != null ? Math.round((currentHr - beforeHr) * 10) / 10 : null,
  };
}

/** Whether the phone has ever synced. Drives what the app offers. */
export async function hasHealthData(ctx: Ctx): Promise<boolean> {
  const { rows } = await ctx.db.query('select 1 from daily_health where user_id = $1 limit 1', [
    ctx.userId,
  ]);
  return rows.length > 0;
}
