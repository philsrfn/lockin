import { type Ctx, transactionFor } from '../db';
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
  ctx: Ctx,
  input: RecordSetInput,
): Promise<{ setId: number; session: Session }> {
  if (input.setIndex < 1) throw badRequest('setIndex starts at 1');
  if (input.reps < 0) throw badRequest('reps cannot be negative');
  if (input.weightKg < 0) throw badRequest('weightKg cannot be negative');
  if (input.rir != null && (input.rir < 0 || input.rir > 10)) {
    throw badRequest('rir must be between 0 and 10');
  }

  const run = async (inner: Ctx) => {
    const session = await inner.db.query('select id from sessions where id = $1 and user_id = $2', [
      input.sessionId,
      inner.userId,
    ]);
    if (!session.rowCount) throw notFound(`No session ${input.sessionId}`);

    // Exercises are a shared catalog of movements, not anyone's data, so this
    // one lookup is deliberately unscoped.
    const exercise = await inner.db.query('select id from exercises where id = $1', [
      input.exerciseId,
    ]);
    if (!exercise.rowCount) throw notFound(`No exercise ${input.exerciseId}`);

    const { rows } = await inner.db.query<{ id: number }>(
      `insert into sets (user_id, session_id, exercise_id, set_index, weight_kg, reps, rir)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (session_id, exercise_id, set_index) do update
         set weight_kg = excluded.weight_kg,
             reps      = excluded.reps,
             rir       = excluded.rir
       returning id`,
      [
        inner.userId,
        input.sessionId,
        input.exerciseId,
        input.setIndex,
        input.weightKg,
        input.reps,
        input.rir ?? null,
      ],
    );

    return { setId: rows[0]!.id, session: await getSession(inner, input.sessionId) };
  };

  return ctx.inTransaction ? run(ctx) : transactionFor(ctx, run);
}

/** Deleting a mis-tap. Returns the session so the logger can re-render. */
export async function deleteSet(ctx: Ctx, id: number): Promise<Session> {
  const { rows } = await ctx.db.query<{ session_id: number }>(
    'delete from sets where id = $1 and user_id = $2 returning session_id',
    [id, ctx.userId],
  );
  const row = rows[0];
  if (!row) throw notFound(`No set ${id}`);
  return getSession(ctx, row.session_id);
}
