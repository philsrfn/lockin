import { type Queryable, pool } from '../db';
import { notFound } from '../errors';
import { templateExerciseNames } from '../domain/templates';

export type Exercise = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[];
};

type ExerciseRow = {
  id: number;
  name: string;
  pattern: string;
  substitutes: number[] | null;
};

const toExercise = (row: ExerciseRow): Exercise => ({
  id: row.id,
  name: row.name,
  pattern: row.pattern,
  substitutes: row.substitutes ?? [],
});

export async function listExercises(db: Queryable = pool): Promise<Exercise[]> {
  const { rows } = await db.query<ExerciseRow>(
    'select id, name, pattern, substitutes from exercises order by id',
  );
  return rows.map(toExercise);
}

export async function getExercise(id: number, db: Queryable = pool): Promise<Exercise> {
  const { rows } = await db.query<ExerciseRow>(
    'select id, name, pattern, substitutes from exercises where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(`No exercise ${id}`);
  return toExercise(row);
}

/**
 * The templates reference exercises by name. Resolve the whole library once and
 * fail at boot if the program points at something the seed does not have —
 * better than discovering it mid-workout.
 */
export async function exercisesByName(db: Queryable = pool): Promise<Map<string, Exercise>> {
  const byName = new Map(
    (await listExercises(db)).map((exercise) => [exercise.name, exercise]),
  );

  const missing = templateExerciseNames().filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Training templates reference exercises that are not in the database: ${missing.join(', ')}`,
    );
  }

  return byName;
}
