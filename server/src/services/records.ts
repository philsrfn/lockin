/**
 * Personal bests, read out of sets that have been sitting there for months.
 *
 * Every number here already existed; nothing new is stored. What was missing
 * was anybody asking the question.
 */
import type { Ctx } from '../db';
import { type ExerciseBests, bestsByExercise } from '../domain/records';

type Row = {
  exercise_id: number;
  exercise_name: string;
  weight_kg: number;
  reps: number;
  performed_at: Date;
};

/**
 * Only finished sessions count.
 *
 * A set logged mid-workout and then deleted because the bar slipped would
 * otherwise stand as a record for the rest of the session, and a record that
 * can be taken back is not one.
 */
const SELECT = `
  select st.exercise_id, e.name as exercise_name, st.weight_kg, st.reps, s.performed_at
  from sets st
  join sessions s on s.id = st.session_id and s.user_id = st.user_id
  join exercises e on e.id = st.exercise_id
  where st.user_id = $1 and st.reps > 0 and s.rpe is not null
`;

const toScored = (row: Row) => ({
  exerciseId: row.exercise_id,
  exerciseName: row.exercise_name,
  weightKg: row.weight_kg,
  reps: row.reps,
  performedAt: row.performed_at.toISOString(),
});

export async function personalBests(ctx: Ctx): Promise<ExerciseBests[]> {
  const { rows } = await ctx.db.query<Row>(`${SELECT} order by s.performed_at`, [ctx.userId]);
  return bestsByExercise(rows.map(toScored));
}

/** The bests for one movement, for deciding whether a new set beats them. */
export async function bestsFor(ctx: Ctx, exerciseId: number): Promise<ExerciseBests | null> {
  const { rows } = await ctx.db.query<Row>(
    `${SELECT} and st.exercise_id = $2 order by s.performed_at`,
    [ctx.userId, exerciseId],
  );
  return bestsByExercise(rows.map(toScored))[0] ?? null;
}
