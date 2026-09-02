/**
 * Cardio.
 *
 * The coach has been prescribing 35 minutes of zone-2 twice a week and had no
 * way to know whether it happened — so the weekly tally counted three lifts and
 * quietly dropped the other two thirds of §4's week.
 *
 * Deliberately not a training log for cyclists. Minutes is the field that
 * matters; distance and heart rate are recorded when the athlete has them and
 * absent when they do not, the same way precision on vegetables is not required
 * in the food logger.
 */
import type { Ctx } from '../db';
import { dayIn, dayRangeIn, daySpanIn } from '../domain/time';
import { badRequest, notFound } from '../errors';
import { athleteZone } from './clock';
import { activeContext } from './contexts';

export type CardioKind = 'zone2' | 'intervals' | 'sport' | 'walk' | 'other';

const KINDS: CardioKind[] = ['zone2', 'intervals', 'sport', 'walk', 'other'];

/**
 * A walk is steps, not a session — counting it towards the weekly cardio
 * target would let somebody hit their week by going to the shops. Anything
 * shorter than this is a warm-up.
 */
const MIN_MINUTES_TO_COUNT = 20;

export function countsTowardWeek(kind: CardioKind, minutes: number): boolean {
  return kind !== 'walk' && minutes >= MIN_MINUTES_TO_COUNT;
}

export type CardioSession = {
  id: number;
  performedAt: string;
  kind: CardioKind;
  minutes: number;
  description: string | null;
  distanceKm: number | null;
  avgHr: number | null;
  rpe: number | null;
  contextName: string | null;
  /** Whether this one moves the weekly tally. */
  counts: boolean;
};

type Row = {
  id: number;
  performed_at: Date;
  kind: string;
  minutes: number;
  description: string | null;
  distance_km: number | null;
  avg_hr: number | null;
  rpe: number | null;
  context_name: string | null;
};

const SELECT = `
  select c.id, c.performed_at, c.kind, c.minutes, c.description,
         c.distance_km, c.avg_hr, c.rpe, x.name as context_name
  from cardio_sessions c
  left join contexts x on x.id = c.context_id
  where c.user_id = $1
`;

const toSession = (row: Row): CardioSession => ({
  id: row.id,
  performedAt: row.performed_at.toISOString(),
  kind: row.kind as CardioKind,
  minutes: row.minutes,
  description: row.description,
  distanceKm: row.distance_km,
  avgHr: row.avg_hr,
  rpe: row.rpe,
  contextName: row.context_name,
  counts: countsTowardWeek(row.kind as CardioKind, row.minutes),
});

export type LogCardioInput = {
  kind: CardioKind;
  minutes: number;
  description?: string | null;
  distanceKm?: number | null;
  avgHr?: number | null;
  rpe?: number | null;
  performedAt?: string;
};

export async function logCardio(
  ctx: Ctx,
  input: LogCardioInput,
): Promise<CardioSession> {
  if (!KINDS.includes(input.kind)) {
    throw badRequest(`kind must be one of ${KINDS.join(', ')}`);
  }
  if (!Number.isFinite(input.minutes) || input.minutes < 1 || input.minutes > 600) {
    throw badRequest('minutes must be between 1 and 600');
  }
  if (input.rpe != null && (input.rpe < 1 || input.rpe > 10)) {
    throw badRequest('RPE must be between 1 and 10');
  }

  // The place, so the trainer knows a run in Leipzig from one at home.
  const context = await activeContext(ctx);

  const { rows } = await ctx.db.query<Row>(
    `with inserted as (
       insert into cardio_sessions
         (user_id, performed_at, context_id, kind, minutes, description, distance_km, avg_hr, rpe)
       values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9)
       returning *
     )
     select i.id, i.performed_at, i.kind, i.minutes, i.description,
            i.distance_km, i.avg_hr, i.rpe, x.name as context_name
     from inserted i left join contexts x on x.id = i.context_id`,
    [
      ctx.userId,
      input.performedAt ?? null,
      context?.id ?? null,
      input.kind,
      Math.round(input.minutes),
      input.description?.trim() || null,
      input.distanceKm ?? null,
      input.avgHr ?? null,
      input.rpe ?? null,
    ],
  );

  return toSession(rows[0]!);
}

export async function deleteCardio(ctx: Ctx, id: number): Promise<void> {
  const { rowCount } = await ctx.db.query(
    'delete from cardio_sessions where id = $1 and user_id = $2',
    [id, ctx.userId],
  );
  if (!rowCount) throw notFound(`No cardio session ${id}`);
}

/** Recent sessions, newest first. */
export async function recentCardio(ctx: Ctx, days = 14): Promise<CardioSession[]> {
  const { rows } = await ctx.db.query<Row>(
    `${SELECT} and c.performed_at >= now() - ($2 || ' days')::interval
     order by c.performed_at desc`,
    [ctx.userId, days],
  );
  return rows.map(toSession);
}

export async function cardioToday(ctx: Ctx, zone?: string): Promise<CardioSession[]> {
  const timezone = zone ?? (await athleteZone(ctx));
  const { from, until } = dayRangeIn(timezone, dayIn(timezone));

  const { rows } = await ctx.db.query<Row>(
    `${SELECT} and c.performed_at >= $2 and c.performed_at < $3
     order by c.performed_at desc`,
    [ctx.userId, from, until],
  );
  return rows.map(toSession);
}

export type CardioDay = { day: string; minutes: number; sessions: number; counted: number };

/** Per-day totals across a span of his days, for the week strip. */
export async function cardioByDay(
  ctx: Ctx,
  firstDay: string,
  lastDay: string,
  zone: string,
): Promise<Map<string, CardioDay>> {
  const span = daySpanIn(zone, firstDay, lastDay);

  const { rows } = await ctx.db.query<{
    day: string;
    minutes: number;
    sessions: number;
    counted: number;
  }>(
    `select to_char(performed_at at time zone $4, 'YYYY-MM-DD') as day,
            coalesce(sum(minutes), 0)::int as minutes,
            count(*)::int as sessions,
            count(*) filter (where kind <> 'walk' and minutes >= ${MIN_MINUTES_TO_COUNT})::int
              as counted
     from cardio_sessions
     where user_id = $1 and performed_at >= $2 and performed_at < $3
     group by 1`,
    [ctx.userId, span.from, span.until, zone],
  );

  return new Map(rows.map((row) => [row.day, row]));
}
