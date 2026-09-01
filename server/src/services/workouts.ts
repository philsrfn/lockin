import { type Queryable, pool } from '../db';
import {
  type JointPainGate,
  type PerformedSet,
  type PrescriptionReason,
  type RampInGate,
  type RepRange,
  jointPainGate,
  nextPrescription,
  rampIn,
} from '../domain/progression';
import { TEMPLATES, type TemplateId, nextTemplate } from '../domain/templates';
import { type Exercise, exercisesByName, listExercises } from './exercises';
import { firstSessionAt } from './sessions';

export type ExercisePrescription = {
  exerciseId: number;
  name: string;
  pattern: string;
  sets: number;
  targetReps: number;
  weightKg: number | null;
  reason: PrescriptionReason;
  restSeconds: number;
  incrementKg: number;
  range: RepRange;
  /** What he did last time this movement came up, for the "(last: …)" line. */
  last: { performedAt: string; sets: PerformedSet[] } | null;
  substitutes: { id: number; name: string; pattern: string }[];
};

export type WorkoutPlan = {
  template: TemplateId;
  rampIn: RampInGate;
  jointPain: JointPainGate;
  exercises: ExercisePrescription[];
};

type HistoryRow = {
  exercise_id: number;
  session_id: number;
  performed_at: Date;
  weight_kg: number;
  reps: number;
  rir: number | null;
};

type ExerciseHistory = { sessionId: number; performedAt: Date; sets: PerformedSet[] }[];

/**
 * Past working sets for the given exercises, grouped into sessions, newest
 * first. One query for the whole template rather than one per movement.
 */
async function historyFor(
  exerciseIds: number[],
  excludeSessionId: number | undefined,
  db: Queryable,
): Promise<Map<number, ExerciseHistory>> {
  const byExercise = new Map<number, ExerciseHistory>();
  if (exerciseIds.length === 0) return byExercise;

  const { rows } = await db.query<HistoryRow>(
    `select st.exercise_id, st.session_id, se.performed_at,
            st.weight_kg, st.reps, st.rir
     from sets st
     join sessions se on se.id = st.session_id
     where st.exercise_id = any($1::int[])
       and ($2::int is null or st.session_id <> $2)
       and st.reps > 0
     order by st.exercise_id, se.performed_at desc, st.set_index`,
    [exerciseIds, excludeSessionId ?? null],
  );

  for (const row of rows) {
    const sessions = byExercise.get(row.exercise_id) ?? [];
    const current = sessions[sessions.length - 1];

    // Rows arrive grouped by exercise then session, so a change of session_id
    // always starts a new group.
    if (current && current.sessionId === row.session_id) {
      current.sets.push({ weightKg: row.weight_kg, reps: row.reps, rir: row.rir });
    } else {
      sessions.push({
        sessionId: row.session_id,
        performedAt: row.performed_at,
        sets: [{ weightKg: row.weight_kg, reps: row.reps, rir: row.rir }],
      });
    }
    byExercise.set(row.exercise_id, sessions);
  }

  return byExercise;
}

/** Sessions he actually closed out, for the joint-pain streak. */
async function finishedSessions(db: Queryable) {
  const { rows } = await db.query<{ performed_at: Date; joint_pain: boolean }>(
    `select performed_at, joint_pain
     from sessions
     where rpe is not null
     order by performed_at desc
     limit 5`,
  );
  return rows.map((row) => ({ performedAt: row.performed_at, jointPain: row.joint_pain }));
}

/** Which day comes next: A → B → C → A, off the last session he logged. */
export async function upcomingTemplate(db: Queryable = pool): Promise<TemplateId> {
  const { rows } = await db.query<{ template: string | null }>(
    `select template from sessions
     where template is not null
     order by performed_at desc
     limit 1`,
  );
  const last = rows[0]?.template;
  return nextTemplate(last === 'A' || last === 'B' || last === 'C' ? last : null);
}

export async function planFor(
  template: TemplateId,
  options: { excludeSessionId?: number; now?: Date } = {},
  db: Queryable = pool,
): Promise<WorkoutPlan> {
  const now = options.now ?? new Date();
  const slots = TEMPLATES[template];

  const [byName, allExercises, firstAt, finished] = await Promise.all([
    exercisesByName(db),
    listExercises(db),
    firstSessionAt(db),
    finishedSessions(db),
  ]);

  const byId = new Map<number, Exercise>(allExercises.map((e) => [e.id, e]));
  const resolved = slots.map((slot) => ({ slot, exercise: byName.get(slot.exerciseName)! }));

  const ramp = rampIn(firstAt, now);
  const gate = jointPainGate(finished);
  const history = await historyFor(
    resolved.map(({ exercise }) => exercise.id),
    options.excludeSessionId,
    db,
  );

  const exercises = resolved.map(({ slot, exercise }) => {
    const sessions = history.get(exercise.id) ?? [];
    const targetSets = Math.min(slot.sets, ramp.maxWorkingSets ?? slot.sets);

    const prescription = nextPrescription({
      exerciseId: exercise.id,
      history: sessions.map((session) => session.sets),
      range: slot.range,
      incrementKg: slot.incrementKg,
      targetSets,
      gate,
    });

    const last = sessions[0];

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      pattern: exercise.pattern,
      sets: prescription.sets,
      targetReps: prescription.targetReps,
      weightKg: prescription.weightKg,
      reason: prescription.reason,
      restSeconds: slot.restSeconds,
      incrementKg: slot.incrementKg,
      range: slot.range,
      last: last ? { performedAt: last.performedAt.toISOString(), sets: last.sets } : null,
      substitutes: exercise.substitutes
        .map((id) => byId.get(id))
        .filter((sub): sub is Exercise => sub !== undefined)
        .map((sub) => ({ id: sub.id, name: sub.name, pattern: sub.pattern })),
    } satisfies ExercisePrescription;
  });

  return { template, rampIn: ramp, jointPain: gate, exercises };
}
