import type { PoolClient } from 'pg';
import { type Queryable, pool, transaction } from '../db';
import { badRequest, notFound } from '../errors';
import { type Session, getSession } from './sessions';

export type RecordSetInput = {
  sessionId: number;
  exerciseId: number;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir?: number | null;
};

/**
 * Records one set. Upserts on (session_id, exercise_id, set_index), which makes
 * this idempotent: the offline queue can replay the same set and a fat-fingered
 * correction can overwrite it, without ever creating a second row.
 *
 * Returns the whole session, per §6 — the caller's next move sees ground truth
 * rather than assuming the write landed.
 */
export async function recordSet(
  input: RecordSetInput,
  client?: PoolClient,
): Promise<{ setId: number; session: Session }> {
  if (input.setIndex < 1) throw badRequest('setIndex starts at 1');
  if (input.reps < 0) throw badRequest('reps cannot be negative');
  if (input.weightKg < 0) throw badRequest('weightKg cannot be negative');
  if (input.rir != null && (input.rir < 0 || input.rir > 10)) {
    throw badRequest('rir must be between 0 and 10');
  }

  const run = async (db: PoolClient) => {
    const session = await db.query('select id from sessions where id = $1', [input.sessionId]);
    if (!session.rowCount) throw notFound(`No session ${input.sessionId}`);

    const exercise = await db.query('select id from exercises where id = $1', [input.exerciseId]);
    if (!exercise.rowCount) throw notFound(`No exercise ${input.exerciseId}`);

    const { rows } = await db.query<{ id: number }>(
      `insert into sets (session_id, exercise_id, set_index, weight_kg, reps, rir)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (session_id, exercise_id, set_index) do update
         set weight_kg = excluded.weight_kg,
             reps      = excluded.reps,
             rir       = excluded.rir
       returning id`,
      [
        input.sessionId,
        input.exerciseId,
        input.setIndex,
        input.weightKg,
        input.reps,
        input.rir ?? null,
      ],
    );

    return { setId: rows[0]!.id, session: await getSession(input.sessionId, db) };
  };

  return client ? run(client) : transaction(run);
}

/** Deleting a mis-tap. Returns the session so the logger can re-render. */
export async function deleteSet(id: number, db: Queryable = pool): Promise<Session> {
  const { rows } = await db.query<{ session_id: number }>(
    'delete from sets where id = $1 returning session_id',
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(`No set ${id}`);
  return getSession(row.session_id, db);
}
