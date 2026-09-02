/**
 * The programme catalogue.
 *
 * Three programmes, seeded, chosen once — §14's "do not build a program
 * builder" with the one concession that three full-body days is the wrong
 * shape for somebody training five times a week. A programme is an ordered
 * list of days that rotates; how often it rotates is how often you train,
 * which is a separate question and already on the profile.
 */
import type { Ctx, Queryable } from '../db';
import type { DayCode, RepRange } from '../domain/program';
import { badRequest, notFound } from '../errors';

export type ProgramDay = {
  position: number;
  code: DayCode;
  name: string;
};

export type Program = {
  id: number;
  slug: string;
  name: string;
  description: string;
  daysPerWeek: number;
  /** In rotation order. */
  days: ProgramDay[];
};

/** One movement on one day, as the programme prescribes it. */
export type ProgramSlot = {
  exerciseId: number;
  exerciseName: string;
  pattern: string;
  sets: number;
  incrementKg: number;
  restSeconds: number;
  range: RepRange;
};

/** The programme every existing athlete is on, and the default for a new one. */
export const DEFAULT_PROGRAM_SLUG = 'full_body_3';

type ProgramRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  days_per_week: number;
  days: ProgramDay[] | null;
};

const SELECT_PROGRAMS = `
  select p.id, p.slug, p.name, p.description, p.days_per_week,
         coalesce(
           json_agg(
             json_build_object('position', d.position, 'code', d.code, 'name', d.name)
             order by d.position
           ) filter (where d.id is not null),
           '[]'
         ) as days
  from programs p
  left join program_days d on d.program_id = p.id
`;

const toProgram = (row: ProgramRow): Program => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  daysPerWeek: row.days_per_week,
  days: row.days ?? [],
});

/** The built-in catalogue, plus anything this athlete owns. */
export async function listPrograms(ctx: Ctx): Promise<Program[]> {
  const { rows } = await ctx.db.query<ProgramRow>(
    `${SELECT_PROGRAMS}
     where p.user_id is null or p.user_id = $1
     group by p.id
     order by p.days_per_week, p.id`,
    [ctx.userId],
  );
  return rows.map(toProgram);
}

async function byId(ctx: Ctx, id: number): Promise<Program | null> {
  const { rows } = await ctx.db.query<ProgramRow>(
    `${SELECT_PROGRAMS}
     where p.id = $2 and (p.user_id is null or p.user_id = $1)
     group by p.id`,
    [ctx.userId, id],
  );
  return rows[0] ? toProgram(rows[0]) : null;
}

export async function programBySlug(db: Queryable, slug: string): Promise<Program | null> {
  const { rows } = await db.query<ProgramRow>(
    `${SELECT_PROGRAMS} where p.slug = $1 and p.user_id is null group by p.id`,
    [slug],
  );
  return rows[0] ? toProgram(rows[0]) : null;
}

/**
 * What this athlete is running. Falls back to the default rather than failing:
 * a profile with no programme should still be able to open the app, and the
 * default is the one everyone was on before there was a choice.
 */
export async function currentProgram(ctx: Ctx): Promise<Program> {
  const { rows } = await ctx.db.query<{ program_id: number | null }>(
    'select program_id from profile where user_id = $1',
    [ctx.userId],
  );

  const chosen = rows[0]?.program_id ? await byId(ctx, rows[0].program_id) : null;
  if (chosen) return chosen;

  const fallback = await programBySlug(ctx.db, DEFAULT_PROGRAM_SLUG);
  if (!fallback) throw new Error('The programme catalogue is empty — did migration 015 run?');
  return fallback;
}

/** The movements of one day, in the order they are performed. */
export async function slotsFor(
  ctx: Ctx,
  programId: number,
  code: DayCode,
): Promise<ProgramSlot[]> {
  const { rows } = await ctx.db.query<{
    exercise_id: number;
    exercise_name: string;
    pattern: string;
    sets: number;
    increment_kg: number;
    rest_seconds: number;
    rep_min: number;
    rep_max: number;
  }>(
    `select s.exercise_id, e.name as exercise_name, e.pattern,
            s.sets, s.increment_kg, s.rest_seconds, s.rep_min, s.rep_max
     from program_slots s
     join program_days d on d.id = s.program_day_id
     join exercises e on e.id = s.exercise_id
     where d.program_id = $1 and d.code = $2
     order by s.position`,
    [programId, code],
  );

  return rows.map((row) => ({
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    pattern: row.pattern,
    sets: row.sets,
    incrementKg: row.increment_kg,
    restSeconds: row.rest_seconds,
    range: { min: row.rep_min, max: row.rep_max },
  }));
}

/**
 * Switching programmes. History is untouched: sessions keep the day code they
 * were logged against, and the rotation simply starts at the top of the new
 * programme, because "what follows C in upper/lower" has no honest answer.
 */
export async function setProgram(ctx: Ctx, programId: number): Promise<Program> {
  const program = await byId(ctx, programId);
  if (!program) throw notFound(`No programme ${programId}`);
  if (program.days.length === 0) throw badRequest('That programme has no days in it');

  await ctx.db.query(
    'update profile set program_id = $2, updated_at = now() where user_id = $1',
    [ctx.userId, programId],
  );
  return program;
}

/**
 * What to start somebody on. Training days is the only thing we know at
 * signup, and it is the thing that actually decides: four days a week is
 * where full-body stops being the best use of them.
 */
export function suggestProgramSlug(trainingDaysPerWeek: number): string {
  return trainingDaysPerWeek >= 4 ? 'upper_lower_4' : DEFAULT_PROGRAM_SLUG;
}
