/**
 * Waist, and the rest of the tape.
 *
 * Weight alone stalls for a fortnight while the mirror keeps changing, and
 * that fortnight is where people quit. A waist measurement is what carries
 * somebody through a flat stretch — and unlike progress photos, it needs no
 * object storage to be useful today.
 *
 * Every field is optional. Somebody who only ever measures their waist should
 * not be asked for a thigh.
 */
import type { Ctx } from '../db';
import { addDays, dayIn } from '../domain/time';
import { badRequest, notFound } from '../errors';
import { athleteZone } from './clock';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A tape measure, not a lab. Bounds catch a slipped decimal, nothing more. */
const PLAUSIBLE_CM = { min: 10, max: 300 };

export type Measurement = {
  measuredOn: string;
  waistCm: number | null;
  hipCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  notes: string | null;
};

type Row = {
  measured_on: string;
  waist_cm: number | null;
  hip_cm: number | null;
  chest_cm: number | null;
  arm_cm: number | null;
  thigh_cm: number | null;
  notes: string | null;
};

const toMeasurement = (row: Row): Measurement => ({
  measuredOn: row.measured_on,
  waistCm: row.waist_cm,
  hipCm: row.hip_cm,
  chestCm: row.chest_cm,
  armCm: row.arm_cm,
  thighCm: row.thigh_cm,
  notes: row.notes,
});

const COLUMNS = 'measured_on, waist_cm, hip_cm, chest_cm, arm_cm, thigh_cm, notes';

export type LogMeasurementInput = {
  measuredOn?: string;
  waistCm?: number | null;
  hipCm?: number | null;
  chestCm?: number | null;
  armCm?: number | null;
  thighCm?: number | null;
  notes?: string | null;
};

const FIELDS = ['waistCm', 'hipCm', 'chestCm', 'armCm', 'thighCm'] as const;

/** One row per day, upserted — measuring twice replaces rather than duplicates. */
export async function logMeasurement(
  ctx: Ctx,
  input: LogMeasurementInput,
): Promise<Measurement> {
  const measuredOn = input.measuredOn ?? dayIn(await athleteZone(ctx));
  if (!ISO_DATE.test(measuredOn)) throw badRequest('measuredOn must be YYYY-MM-DD');

  const given = FIELDS.filter((field) => input[field] != null);
  if (given.length === 0 && !input.notes?.trim()) {
    throw badRequest('Nothing to record');
  }

  for (const field of given) {
    const value = input[field]!;
    if (!Number.isFinite(value) || value < PLAUSIBLE_CM.min || value > PLAUSIBLE_CM.max) {
      throw badRequest(`${field} must be between ${PLAUSIBLE_CM.min} and ${PLAUSIBLE_CM.max} cm`);
    }
  }

  const { rows } = await ctx.db.query<Row>(
    `insert into measurements (user_id, measured_on, waist_cm, hip_cm, chest_cm, arm_cm, thigh_cm, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, measured_on) do update set
       -- coalesce, not overwrite: measuring only a waist today must not erase
       -- the chest measurement taken this morning.
       waist_cm = coalesce(excluded.waist_cm, measurements.waist_cm),
       hip_cm   = coalesce(excluded.hip_cm,   measurements.hip_cm),
       chest_cm = coalesce(excluded.chest_cm, measurements.chest_cm),
       arm_cm   = coalesce(excluded.arm_cm,   measurements.arm_cm),
       thigh_cm = coalesce(excluded.thigh_cm, measurements.thigh_cm),
       notes    = coalesce(excluded.notes,    measurements.notes)
     returning ${COLUMNS}`,
    [
      ctx.userId,
      measuredOn,
      input.waistCm ?? null,
      input.hipCm ?? null,
      input.chestCm ?? null,
      input.armCm ?? null,
      input.thighCm ?? null,
      input.notes?.trim() || null,
    ],
  );

  return toMeasurement(rows[0]!);
}

export async function listMeasurements(ctx: Ctx, days = 180): Promise<Measurement[]> {
  // Counted from his today. `current_date` would be the database server's.
  const from = addDays(dayIn(await athleteZone(ctx)), -days);

  const { rows } = await ctx.db.query<Row>(
    `select ${COLUMNS} from measurements
     where user_id = $1 and measured_on >= $2::date
     order by measured_on desc`,
    [ctx.userId, from],
  );
  return rows.map(toMeasurement);
}

export async function deleteMeasurement(ctx: Ctx, measuredOn: string): Promise<void> {
  const { rowCount } = await ctx.db.query(
    'delete from measurements where user_id = $1 and measured_on = $2::date',
    [ctx.userId, measuredOn],
  );
  if (!rowCount) throw notFound(`Nothing measured on ${measuredOn}`);
}
