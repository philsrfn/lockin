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
import { transactionFor } from '../db';
import type { DayCode, RepRange } from '../domain/program';
import { defaultsForPattern } from '../domain/program';
import {
  type Draft,
  type DraftDay,
  assignCodes,
  validateDraft,
} from '../domain/programDraft';
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

/* -------------------------------------------------------------------------
 * Programmes an athlete builds themselves.
 *
 * §14 said not to build a generic programme builder, and for one man with one
 * rotation that was right. It stopped being right when other people started
 * using this: three presets chosen around somebody else's gym are the
 * opposite of hyperpersonal, and the person standing in front of a rack that
 * their programme does not mention is not helped by a catalogue.
 *
 * Migration 015 already left the door open — `programs.user_id` null means
 * built-in, and reading has always included an athlete's own rows. Only the
 * writing was missing.
 * ---------------------------------------------------------------------- */

/**
 * Saved whole, never in pieces.
 *
 * An editor is a form: you move an exercise, rename a day, change a rep range
 * and then press save. Nine granular routes would each need their own
 * ordering rules and their own way to leave the programme half-edited. One
 * replace inside a transaction cannot.
 */
export async function saveProgram(ctx: Ctx, programId: number, draft: Draft): Promise<Program> {
  const problems = validateDraft(draft);
  if (problems.length > 0) throw badRequest(`This programme is not usable: ${problems.join(', ')}`);

  const run = async (inner: Ctx): Promise<Program> => {
    await assertOwn(inner, programId);

    // The codes of days that already exist are read back rather than trusted
    // from the client: a caller that invented one could re-point a code at a
    // different set of movements and rewrite what old sessions meant.
    const { rows: existing } = await inner.db.query<{ id: number; code: string }>(
      `select d.id, d.code from program_days d
       join programs p on p.id = d.program_id
       where d.program_id = $2 and p.user_id = $1`,
      [inner.userId, programId],
    );
    const known = new Set(existing.map((row) => row.code));
    const days = assignCodes(
      draft.days.map((day): DraftDay => ({
        ...day,
        code: day.code && known.has(day.code) ? day.code : undefined,
      })),
    );

    await inner.db.query(
      'update programs set name = $3, days_per_week = $4 where id = $2 and user_id = $1',
      [inner.userId, programId, draft.name.trim(), Math.min(7, Math.max(1, days.length))],
    );

    // Replaced wholesale. Sessions reference the code, not the row, so
    // dropping a day takes nothing with it that history depends on.
    await inner.db.query(
      `delete from program_days d
       using programs p
       where p.id = d.program_id and d.program_id = $2 and p.user_id = $1`,
      [inner.userId, programId],
    );

    for (const [position, day] of days.entries()) {
      // The select enforces ownership on the way in, so a programme id that
      // is not this athlete's inserts nothing rather than inserting a day
      // into somebody else's plan.
      const { rows } = await inner.db.query<{ id: number }>(
        `insert into program_days (program_id, position, code, name)
         select p.id, $3, $4, $5 from programs p where p.id = $2 and p.user_id = $1
         returning id`,
        [inner.userId, programId, position, day.code, day.name],
      );
      if (!rows[0]) throw notFound(`No programme ${programId} of yours to edit`);
      const dayId = rows[0].id;

      for (const [slotPosition, slot] of day.slots.entries()) {
        // Increment, rest and the default range come from the movement
        // pattern, not from the athlete: those are the numbers progression
        // runs on, and §1 keeps them in code.
        const { rows: exerciseRows } = await inner.db.query<{ pattern: string }>(
          'select pattern from exercises where id = $1',
          [slot.exerciseId],
        );
        const pattern = exerciseRows[0]?.pattern;
        if (!pattern) throw badRequest(`No exercise ${slot.exerciseId}`);
        const defaults = defaultsForPattern(pattern);

        await inner.db.query(
          `insert into program_slots
             (program_day_id, position, exercise_id, sets, increment_kg, rest_seconds,
              rep_min, rep_max)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            dayId,
            slotPosition,
            slot.exerciseId,
            slot.sets,
            defaults.incrementKg,
            defaults.restSeconds,
            slot.repMin,
            slot.repMax,
          ],
        );
      }
    }

    const saved = await byId(inner, programId);
    if (!saved) throw notFound(`No programme ${programId}`);
    return saved;
  };

  return ctx.inTransaction ? run(ctx) : transactionFor(ctx, run);
}

/** Refuses anything built in, which is shared by everyone. */
async function assertOwn(ctx: Ctx, programId: number): Promise<void> {
  const { rows } = await ctx.db.query<{ id: number }>(
    'select id from programs where id = $2 and user_id = $1',
    [ctx.userId, programId],
  );
  if (rows.length === 0) {
    throw notFound(`No programme ${programId} of yours to edit`);
  }
}

/**
 * A new programme, optionally forked from one that already exists.
 *
 * Forking is the sane default and blank is the honest alternative. "PPL, but
 * with my gym's machines" is what almost everybody means; starting from
 * nothing means typing thirty exercises before the first session, which is a
 * reason to give up rather than a feature.
 */
export async function createProgram(
  ctx: Ctx,
  input: { name: string; fromProgramId?: number | null },
): Promise<Program> {
  const name = input.name?.trim();
  if (!name) throw badRequest('A programme needs a name');

  const source = input.fromProgramId ? await byId(ctx, input.fromProgramId) : null;
  if (input.fromProgramId && !source) throw notFound(`No programme ${input.fromProgramId}`);

  const run = async (inner: Ctx): Promise<Program> => {
    const { rows } = await inner.db.query<{ id: number }>(
      `insert into programs (user_id, slug, name, description, days_per_week)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        inner.userId,
        // Slugs are only unique among the built-ins; this one exists so the
        // column is not null and so a fork is recognisable in the database.
        `own_${inner.userId}_${Date.now().toString(36)}`,
        name,
        source ? `Nach ${source.name}` : 'Eigenes Programm',
        source?.days.length ?? 1,
      ],
    );
    const created = rows[0]!.id;

    if (source && source.days.length > 0) {
      // Slots hang off the day rather than travelling with it, so a fork
      // reads each day's movements before it can copy them.
      const days: DraftDay[] = [];
      for (const day of source.days) {
        const slots = await slotsFor(inner, source.id, day.code);
        days.push({
          // Deliberately no code: a fork is a new programme, and its days
          // start their own history rather than inheriting the original's.
          name: day.name,
          slots: slots.map((slot) => ({
            exerciseId: slot.exerciseId,
            sets: slot.sets,
            repMin: slot.range.min,
            repMax: slot.range.max,
          })),
        });
      }
      await saveProgram(inner, created, { name, days });
    }

    const program = await byId(inner, created);
    if (!program) throw notFound('The programme vanished as it was created');
    return program;
  };

  return ctx.inTransaction ? run(ctx) : transactionFor(ctx, run);
}

/**
 * Deleting one you are not using.
 *
 * Refused while it is the current programme rather than silently moving
 * somebody onto another one: which programme you are running decides what the
 * app tells you to lift tomorrow, and that is not a thing to change as a side
 * effect of tidying up.
 */
export async function deleteProgram(ctx: Ctx, programId: number): Promise<void> {
  await assertOwn(ctx, programId);

  const { rows } = await ctx.db.query<{ program_id: number | null }>(
    'select program_id from profile where user_id = $1',
    [ctx.userId],
  );
  if (rows[0]?.program_id === programId) {
    throw badRequest('That is the programme you are on. Switch to another one first.');
  }

  await ctx.db.query('delete from programs where id = $2 and user_id = $1', [
    ctx.userId,
    programId,
  ]);
}


export type ProgramWithSlots = Program & {
  days: (ProgramDay & { slots: ProgramSlot[] })[];
  /** False for the built-in three, which nobody may edit. */
  mine: boolean;
};

/**
 * A programme in the shape an editor needs: every day with its movements.
 *
 * `listPrograms` deliberately leaves slots out — the account screen draws day
 * names and nothing else, and fetching every exercise of every programme to
 * render four words would be wasteful. Editing is the case where they are
 * the whole point.
 */
export async function programWithSlots(ctx: Ctx, id: number): Promise<ProgramWithSlots> {
  const program = await byId(ctx, id);
  if (!program) throw notFound(`No programme ${id}`);

  const { rows } = await ctx.db.query<{ mine: boolean }>(
    'select (user_id = $1) as mine from programs where id = $2 and (user_id is null or user_id = $1)',
    [ctx.userId, id],
  );

  const days = [];
  for (const day of program.days) {
    days.push({ ...day, slots: await slotsFor(ctx, id, day.code) });
  }

  return { ...program, days, mine: rows[0]?.mine === true };
}
