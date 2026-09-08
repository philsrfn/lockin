import type { Ctx } from '../db';
import { estimated1RM } from '../domain/records';
import { notFound } from '../errors';
import {
  type JointPainGate,
  type PerformedSet,
  type PrescriptionReason,
  type RampInGate,
  type RepRange,
  jointPainGate,
  nextPrescription,
  rampIn,
  roundToIncrement,
} from '../domain/progression';
import { type DayCode, defaultsForPattern, nextInRotation } from '../domain/program';
import { DELOAD_LOAD_FACTOR, type DeloadStatus, deloadSets } from '../domain/deload';
import { addDays, dayIn, daySpanIn } from '../domain/time';
import { athleteZone } from './clock';
import { type Exercise, availableAt, equipmentAt, getExercise, listExercises } from './exercises';
import { activeContext } from './contexts';
import { currentDeload } from './deloads';
import { type Program, currentProgram, slotsFor } from './programs';
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
  /**
   * Whether this is loaded with plates. The logger shows a bar loading for
   * these and nothing for the rest — offering "2 × 20 and a 5" for a cable
   * pulldown would be nonsense dressed as help.
   */
  barbell: boolean;
  /** What he did last time this movement came up, for the "(last: …)" line. */
  last: { performedAt: string; sets: PerformedSet[] } | null;
  substitutes: { id: number; name: string; pattern: string }[];
};

export type WorkoutPlan = {
  /** The day code, stored on the session: 'A', 'U1', 'Push'. */
  template: DayCode;
  /** A scheduled light week, if this is one. */
  deload: DeloadStatus;
  /** What to call it on screen. 'Full body A', 'Upper', 'Push'. */
  dayName: string;
  programName: string;
  /**
   * Every day of the programme, in rotation order.
   *
   * The plan proposes the next one; it does not get to insist. Somebody
   * standing in a gym with friends who are doing Pull today is not going to
   * do Full Body B because a rotation says so — they will either train Pull
   * and log nothing, or log it against the wrong day. Both are worse than
   * letting them pick, and picking is what makes the history honest.
   */
  days: { code: DayCode; name: string; isToday: boolean }[];
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
  ctx: Ctx,
  exerciseIds: number[],
  excludeSessionId: number | undefined,
): Promise<Map<number, ExerciseHistory>> {
  const byExercise = new Map<number, ExerciseHistory>();
  if (exerciseIds.length === 0) return byExercise;

  const { rows } = await ctx.db.query<HistoryRow>(
    `select st.exercise_id, st.session_id, se.performed_at,
            st.weight_kg, st.reps, st.rir
     from sets st
     join sessions se on se.id = st.session_id
     where st.user_id = $1
       and st.exercise_id = any($2::int[])
       and ($3::int is null or st.session_id <> $3)
       and st.reps > 0
     order by st.exercise_id, se.performed_at desc, st.set_index`,
    [ctx.userId, exerciseIds, excludeSessionId ?? null],
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
async function finishedSessions(ctx: Ctx) {
  const { rows } = await ctx.db.query<{ performed_at: Date; joint_pain: boolean }>(
    `select performed_at, joint_pain
     from sessions
     where user_id = $1 and rpe is not null
     order by performed_at desc
     limit 5`,
    [ctx.userId],
  );
  return rows.map((row) => ({ performedAt: row.performed_at, jointPain: row.joint_pain }));
}

/**
 * The day today's plan should be built from.
 *
 * A session in progress decides it — except when that session belongs to a
 * programme the athlete has since left. Switching from Full body to PPL with
 * an unfinished "B" open asked PPL for a day called B, which it does not have,
 * and the 404 took the whole Today payload with it: the home screen, the
 * trainer's context and every screen that depends on either. The app simply
 * stopped, and the only way out was to switch back.
 *
 * An open session from an abandoned programme is history, not a plan. The
 * sets already logged on it stay exactly where they are.
 */
export async function templateForToday(
  ctx: Ctx,
  openTemplate: DayCode | null,
  program?: Program,
): Promise<DayCode> {
  const chosen = program ?? (await currentProgram(ctx));

  if (openTemplate && chosen.days.some((day) => day.code === openTemplate)) {
    return openTemplate;
  }

  return upcomingTemplate(ctx, chosen);
}

/** Which day comes next: A → B → C → A, off the last session he logged. */
export async function upcomingTemplate(ctx: Ctx, program?: Program): Promise<DayCode> {
  const chosen = program ?? (await currentProgram(ctx));
  const { rows } = await ctx.db.query<{ template: string | null }>(
    `select template from sessions
     where user_id = $1 and template is not null
     order by performed_at desc
     limit 1`,
    [ctx.userId],
  );

  const next = nextInRotation(
    chosen.days.map((day) => day.code),
    rows[0]?.template ?? null,
  );
  if (!next) throw new Error(`Programme ${chosen.slug} has no days`);
  return next;
}

export async function planFor(
  ctx: Ctx,
  template: DayCode,
  options: { excludeSessionId?: number; now?: Date } = {},
): Promise<WorkoutPlan> {
  const now = options.now ?? new Date();

  const program = await currentProgram(ctx);
  const day = program.days.find((entry) => entry.code === template);
  if (!day) throw notFound(`${program.name} has no day called ${template}`);

  const [slots, allExercises, firstAt, finished, context, deload] = await Promise.all([
    slotsFor(ctx, program.id, day.code),
    listExercises(ctx.db),
    firstSessionAt(ctx),
    finishedSessions(ctx),
    activeContext(ctx),
    currentDeload(ctx),
  ]);

  const byId = new Map<number, Exercise>(allExercises.map((e) => [e.id, e]));
  // A hotel room with two dumbbells should not offer a hack squat as the
  // alternative to a back squat.
  const here = equipmentAt(context);

  const ramp = rampIn(firstAt, now);
  const gate = jointPainGate(finished);
  const history = await historyFor(
    ctx,
    slots.map((slot) => slot.exerciseId),
    options.excludeSessionId,
  );

  const exercises = slots.map((slot) => {
    const exercise = byId.get(slot.exerciseId)!;
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

    // A light week comes off the top of whatever progression decided, and
    // rounds down — a deload that rounds back up is not a deload.
    const deloaded =
      deload.active && prescription.weightKg != null
        ? roundToIncrement(prescription.weightKg * DELOAD_LOAD_FACTOR, slot.incrementKg, 'down')
        : prescription.weightKg;

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      pattern: exercise.pattern,
      sets: deload.active ? deloadSets(prescription.sets) : prescription.sets,
      targetReps: prescription.targetReps,
      weightKg: deloaded,
      reason: deload.active ? 'deload' : prescription.reason,
      restSeconds: slot.restSeconds,
      incrementKg: slot.incrementKg,
      range: slot.range,
      barbell: exercise.equipment.includes('barbell'),
      last: last ? { performedAt: last.performedAt.toISOString(), sets: last.sets } : null,
      substitutes: exercise.substitutes
        .map((id) => byId.get(id))
        .filter((sub): sub is Exercise => sub !== undefined && availableAt(sub, here))
        .map((sub) => ({ id: sub.id, name: sub.name, pattern: sub.pattern })),
    } satisfies ExercisePrescription;
  });

  return {
    template,
    deload,
    dayName: day.name,
    programName: program.name,
    days: program.days.map((option) => ({
      code: option.code,
      name: option.name,
      isToday: option.code === template,
    })),
    rampIn: ramp,
    jointPain: gate,
    exercises,
  };
}

/**
 * A prescription for any single exercise, template or not. This is what a swap
 * needs: he trades Hack Squat for Leg Press mid-session and still gets the load
 * his own Leg Press history says he should be using, not a blank field.
 *
 * Phase 2's swap_exercise tool calls this same function.
 */
export async function prescribeExercise(
  ctx: Ctx,
  exerciseId: number,
  options: { excludeSessionId?: number; targetSets?: number; now?: Date } = {},
): Promise<ExercisePrescription> {
  const now = options.now ?? new Date();

  const [exercise, allExercises, firstAt, finished, context] = await Promise.all([
    getExercise(exerciseId, ctx.db),
    listExercises(ctx.db),
    firstSessionAt(ctx),
    finishedSessions(ctx),
    activeContext(ctx),
  ]);

  const byId = new Map<number, Exercise>(allExercises.map((e) => [e.id, e]));
  const here = equipmentAt(context);
  const defaults = defaultsForPattern(exercise.pattern);
  const ramp = rampIn(firstAt, now);
  const gate = jointPainGate(finished);

  const history = await historyFor(ctx, [exerciseId], options.excludeSessionId);
  const sessions = history.get(exerciseId) ?? [];

  const requested = options.targetSets ?? 3;
  const targetSets = Math.min(requested, ramp.maxWorkingSets ?? requested);

  const prescription = nextPrescription({
    exerciseId,
    history: sessions.map((session) => session.sets),
    range: defaults.range,
    incrementKg: defaults.incrementKg,
    targetSets,
    gate,
  });

  const last = sessions[0];

  return {
    exerciseId,
    name: exercise.name,
    pattern: exercise.pattern,
    sets: prescription.sets,
    targetReps: prescription.targetReps,
    weightKg: prescription.weightKg,
    reason: prescription.reason,
    restSeconds: defaults.restSeconds,
    incrementKg: defaults.incrementKg,
    range: defaults.range,
    barbell: exercise.equipment.includes('barbell'),
    last: last ? { performedAt: last.performedAt.toISOString(), sets: last.sets } : null,
    substitutes: exercise.substitutes
      .map((id) => byId.get(id))
      .filter((sub): sub is Exercise => sub !== undefined && availableAt(sub, here))
      .map((sub) => ({ id: sub.id, name: sub.name, pattern: sub.pattern })),
  };
}

export type ExerciseProgress = {
  exerciseId: number;
  name: string;
  pattern: string;
  /** Best working set per session, oldest first — the line he wants to see. */
  points: { date: string; weightKg: number; reps: number; estimated1rm: number }[];
};

export type Progress = {
  sessionCount: number;
  setCount: number;
  totalVolumeKg: number;
  exercises: ExerciseProgress[];
};

/**
 * Strength over time. Epley (w × (1 + reps/30)) collapses weight and reps into
 * one comparable number, so 3×8 at 80kg and 3×5 at 90kg can be told apart —
 * without it a chart of raw weight calls a heavier triple "progress" over a
 * much harder set of eight.
 *
 * Arithmetic, in code, per §1.
 */
export async function progress(ctx: Ctx, days = 90, zone?: string): Promise<Progress> {
  // Calendar days in his zone, so a session logged at 22:00 is charted on the
  // day he trained rather than the next one.
  const timezone = zone ?? (await athleteZone(ctx));
  const lastDay = dayIn(timezone);
  const span = daySpanIn(timezone, addDays(lastDay, -(days - 1)), lastDay);

  const { rows } = await ctx.db.query<{
    exercise_id: number;
    name: string;
    pattern: string;
    performed_on: string;
    weight_kg: number;
    reps: number;
  }>(
    `select st.exercise_id, e.name, e.pattern,
            to_char(se.performed_at at time zone $4, 'YYYY-MM-DD') as performed_on,
            st.weight_kg, st.reps
     from sets st
     join sessions se on se.id = st.session_id
     join exercises e on e.id = st.exercise_id
     where st.user_id = $1 and se.performed_at >= $2 and se.performed_at < $3
       and st.reps > 0
     order by e.name, se.performed_at`,
    [ctx.userId, span.from, span.until, timezone],
  );

  const byExercise = new Map<number, ExerciseProgress>();
  // Best set per exercise per day, so one session contributes one point.
  const best = new Map<string, { date: string; weightKg: number; reps: number; estimated1rm: number }>();

  let setCount = 0;
  let totalVolumeKg = 0;
  const sessions = new Set<string>();

  for (const row of rows) {
    setCount += 1;
    totalVolumeKg += row.weight_kg * row.reps;
    sessions.add(row.performed_on);

    if (!byExercise.has(row.exercise_id)) {
      byExercise.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: row.name,
        pattern: row.pattern,
        points: [],
      });
    }

    const key = `${row.exercise_id}:${row.performed_on}`;
    const estimated1rm = estimated1RM(row.weight_kg, row.reps);
    const current = best.get(key);
    if (!current || estimated1rm > current.estimated1rm) {
      best.set(key, { date: row.performed_on, weightKg: row.weight_kg, reps: row.reps, estimated1rm });
    }
  }

  for (const [key, point] of best) {
    const exerciseId = Number(key.split(':')[0]);
    byExercise.get(exerciseId)?.points.push(point);
  }

  const exercises = [...byExercise.values()]
    .map((entry) => ({
      ...entry,
      points: entry.points.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    // Most-trained first: what he actually cares about is at the top.
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));

  return {
    sessionCount: sessions.size,
    setCount,
    totalVolumeKg: Math.round(totalVolumeKg),
    exercises,
  };
}
