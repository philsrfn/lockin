import { type Queryable, pool } from '../db';
import { notFound } from '../errors';

export type Exercise = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[];
  /** What it needs: 'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'… */
  equipment: string[];
};

type ExerciseRow = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[] | null;
  equipment: string[] | null;
};

const toExercise = (row: ExerciseRow): Exercise => ({
  id: row.id,
  name: row.name,
  pattern: row.pattern,
  substitutes: row.substitutes ?? [],
  equipment: row.equipment ?? [],
});

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

export async function listExercises(db: Queryable = pool): Promise<Exercise[]> {
  const { rows } = await db.query<ExerciseRow>(
    'select id, name, pattern, substitutes, equipment from exercises order by id',
  );
  return rows.map(toExercise);
}

export async function getExercise(id: number, db: Queryable = pool): Promise<Exercise> {
  const { rows } = await db.query<ExerciseRow>(
    'select id, name, pattern, substitutes, equipment from exercises where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(`No exercise ${id}`);
  return toExercise(row);
}

/**
 * The library keyed by name, for the places that resolve a movement the athlete
 * or the model typed rather than one the programme names.
 *
 * The programme used to reference exercises by name and this function checked
 * them at boot. Programmes are rows now, and `program_slots.exercise_id` is a
 * foreign key — the database refuses a drifted name at migration time, which
 * is earlier and stricter than a startup check.
 */
export async function exercisesByName(db: Queryable = pool): Promise<Map<string, Exercise>> {
  return new Map((await listExercises(db)).map((exercise) => [exercise.name, exercise]));
}
