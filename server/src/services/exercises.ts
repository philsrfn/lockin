import { type Ctx, type Queryable, pool } from '../db';
import { badRequest, notFound } from '../errors';

export type Exercise = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[];
  /** What it needs: 'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'… */
  equipment: string[];
  /** True when this athlete made it, false for the shared catalogue. */
  custom: boolean;
};

/** The seven the check constraint on `exercises.pattern` allows. */
export const PATTERNS = ['squat', 'hinge', 'h_push', 'v_push', 'h_pull', 'v_pull', 'iso'] as const;

type ExerciseRow = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[] | null;
  equipment: string[] | null;
  user_id: number | null;
};

const toExercise = (row: ExerciseRow): Exercise => ({
  id: row.id,
  name: row.name,
  pattern: row.pattern,
  substitutes: row.substitutes ?? [],
  equipment: row.equipment ?? [],
  custom: row.user_id !== null,
});

const COLUMNS = 'id, name, pattern, substitutes, equipment, user_id';

/**
 * Whether a place can do this movement. A place that has not said what it has
 * can do everything — nobody is going to inventory a commercial gym, and
 * assuming the worst would empty the swap list for the majority.
 */
export function availableAt(exercise: Exercise, available: string[] | null): boolean {
  if (!available || available.length === 0) return true;
  return exercise.equipment.every((item) => available.includes(item));
}

/** What a context says it has, or null when it has not said. */
export function equipmentAt(context: { equipment?: Record<string, unknown> } | null): string[] | null {
  const list = context?.equipment?.available;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : null;
}

/**
 * The library this athlete can see: the shared catalogue plus their own.
 *
 * Migration 035 made `exercises` a table with both kinds of row in it, the
 * same way `programs` has been since 015, which is why the predicate looks
 * like that one's. The catalogue comes first so the picker's groups open with
 * movements everybody knows, and a movement somebody invented sits under them
 * rather than at the top of a list it is not the most likely answer in.
 */
export async function listExercises(ctx: Ctx): Promise<Exercise[]> {
  const { rows } = await ctx.db.query<ExerciseRow>(
    `select ${COLUMNS} from exercises
     where user_id is null or user_id = $1
     order by user_id nulls first, id`,
    [ctx.userId],
  );
  return rows.map(toExercise);
}

export async function getExercise(ctx: Ctx, id: number): Promise<Exercise> {
  const { rows } = await ctx.db.query<ExerciseRow>(
    `select ${COLUMNS} from exercises
     where id = $1 and (user_id is null or user_id = $2)`,
    [id, ctx.userId],
  );
  const row = rows[0];
  if (!row) throw notFound(`No exercise ${id}`);
  return toExercise(row);
}

/**
 * A movement the athlete has and the catalogue does not.
 *
 * Name and pattern, and nothing else required. The pattern is not a taxonomy
 * exercise — it is load-bearing, because `swap_exercise` (§6) may only trade
 * inside one, and a movement filed under the wrong pattern turns up as the
 * alternative to something it cannot replace. Equipment is optional because a
 * movement with none listed is available everywhere, which is the same
 * forgiving default `availableAt` has always applied to a place that has not
 * inventoried itself.
 *
 * No substitutes: nothing else in the catalogue knows what this movement is,
 * so any chain would be invented rather than chosen. The swap button offers
 * nothing for it, which is honest.
 */
export async function createExercise(
  ctx: Ctx,
  input: { name: string; pattern: string; equipment?: string[] },
): Promise<Exercise> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest('An exercise needs a name');

  /**
   * Case-insensitively, against both halves of what they can see.
   *
   * The two partial unique indexes migration 035 added would let "bench
   * press" in beside the catalogue's "Bench Press" and beside their own, and
   * the result is two rows in the picker that look identical and accumulate
   * half a history each. Caught here rather than by a third index, because
   * the answer worth giving names the movement they already have and a
   * constraint violation cannot.
   */
  const { rows: clash } = await ctx.db.query<{ name: string }>(
    `select name from exercises
     where lower(name) = lower($1) and (user_id is null or user_id = $2)
     limit 1`,
    [name, ctx.userId],
  );
  if (clash[0]) throw badRequest(`${clash[0].name} is already in the library`);

  const { rows } = await ctx.db.query<ExerciseRow>(
    `insert into exercises (user_id, name, pattern, equipment)
     values ($1, $2, $3, $4)
     returning ${COLUMNS}`,
    [ctx.userId, name, input.pattern, input.equipment ?? []],
  );
  return toExercise(rows[0]!);
}

/**
 * The shared catalogue keyed by name, for the boot check and nothing else.
 *
 * Deliberately unscoped: it reads the rows that belong to nobody, which is why
 * it can run before any request exists. Anything answering an athlete wants
 * `listExercises`, which also carries what they made themselves.
 *
 * The programme used to reference exercises by name and this function checked
 * them at boot. Programmes are rows now, and `program_slots.exercise_id` is a
 * foreign key — the database refuses a drifted name at migration time, which
 * is earlier and stricter than a startup check.
 */
export async function exercisesByName(db: Queryable = pool): Promise<Map<string, Exercise>> {
  const { rows } = await db.query<ExerciseRow>(
    `select ${COLUMNS} from exercises where user_id is null order by id`,
  );
  return new Map(rows.map((row) => [row.name, toExercise(row)]));
}
