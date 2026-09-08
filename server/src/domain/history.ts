/**
 * Past training, arranged for reading.
 *
 * The app has always been able to answer "what do I do today" and "am I
 * getting stronger". It could not answer "what did I actually do on Tuesday",
 * which is the question you ask when a weight feels wrong, when somebody asks
 * how your week went, or when you simply want to see that the work happened.
 *
 * Two pure pieces: grouping a mixed list into days, and reducing a session's
 * sets to the two or three numbers worth putting on a row.
 */
import { dayIn } from './time';

export type Dated = { performedAt: string };

export type TrainingDay<S extends Dated, C extends Dated> = {
  /** YYYY-MM-DD in the athlete's own zone, not the server's. */
  day: string;
  sessions: S[];
  cardio: C[];
};

/**
 * Days newest first, and newest first inside each day too.
 *
 * Consistent rather than chronological on purpose: a list that runs backwards
 * at the top level and forwards inside each group makes the reader change
 * direction halfway down, and a day holds one or two entries anyway.
 *
 * A day appears only if something happened in it. Rest days are most days —
 * the weekly target is three lifts and two cardio sessions — so padding the
 * list with them would bury the training under the rest.
 */
export function groupTrainingByDay<S extends Dated, C extends Dated>(
  zone: string,
  sessions: S[],
  cardio: C[],
): TrainingDay<S, C>[] {
  const days = new Map<string, TrainingDay<S, C>>();

  const dayFor = (day: string): TrainingDay<S, C> => {
    const existing = days.get(day);
    if (existing) return existing;
    const fresh: TrainingDay<S, C> = { day, sessions: [], cardio: [] };
    days.set(day, fresh);
    return fresh;
  };

  const newestFirst = (a: Dated, b: Dated) => b.performedAt.localeCompare(a.performedAt);

  for (const session of [...sessions].sort(newestFirst)) {
    dayFor(dayIn(zone, new Date(session.performedAt))).sessions.push(session);
  }
  for (const entry of [...cardio].sort(newestFirst)) {
    dayFor(dayIn(zone, new Date(entry.performedAt))).cardio.push(entry);
  }

  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export type PerformedSet = {
  exerciseId: number;
  exerciseName: string;
  weightKg: number;
  reps: number;
};

export type ExerciseSummary = {
  exerciseId: number;
  exerciseName: string;
  sets: number;
  /** The heaviest set, which is the one a lifter looks for. */
  topWeightKg: number;
  /** Reps on that heaviest set — not the most reps done at any weight. */
  topReps: number;
};

export type SessionSummary = {
  setCount: number;
  totalVolumeKg: number;
  /** In the order the exercises were first performed. */
  exercises: ExerciseSummary[];
};

/**
 * A session's sets reduced to a row you can read at a glance.
 *
 * "Top set" is the heaviest, with more reps breaking a tie at equal weight.
 * Not the highest volume set and not the last one: after a working set at
 * 90 kg, a back-off at 70 is not the number you are looking for.
 *
 * Volume is weight × reps summed over every set, rounded once at the end
 * rather than per set, so a hundred half-kilo roundings cannot accumulate
 * into a visible lie.
 */
export function summariseSets(sets: PerformedSet[]): SessionSummary {
  const byExercise = new Map<number, ExerciseSummary>();
  let totalVolumeKg = 0;

  for (const set of sets) {
    totalVolumeKg += set.weightKg * set.reps;

    const existing = byExercise.get(set.exerciseId);
    if (!existing) {
      byExercise.set(set.exerciseId, {
        exerciseId: set.exerciseId,
        exerciseName: set.exerciseName,
        sets: 1,
        topWeightKg: set.weightKg,
        topReps: set.reps,
      });
      continue;
    }

    existing.sets += 1;
    const heavier = set.weightKg > existing.topWeightKg;
    const sameWeightMoreReps = set.weightKg === existing.topWeightKg && set.reps > existing.topReps;
    if (heavier || sameWeightMoreReps) {
      existing.topWeightKg = set.weightKg;
      existing.topReps = set.reps;
    }
  }

  return {
    setCount: sets.length,
    totalVolumeKg: Math.round(totalVolumeKg),
    exercises: [...byExercise.values()],
  };
}
