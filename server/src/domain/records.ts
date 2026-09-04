/**
 * Personal records — the thing the data has been able to answer for months
 * and nobody has asked.
 *
 * Every set is already stored with its weight and its reps. What was missing
 * is the sentence "that was your best", which is the whole reason people keep
 * a training log at all and the one moment a logger can be gratifying rather
 * than merely diligent.
 *
 * Two kinds, because they answer different questions and disagree often:
 *
 *   heaviest — the most weight moved for any number of reps. What somebody
 *   means when they say what they squat.
 *
 *   strongest — the best set by estimated one-rep max, which lets a set of
 *   eight beat a hard triple. This is the one that tracks getting stronger;
 *   the heaviest can sit still for months while every set under it improves.
 */

/**
 * Epley. Was inline arithmetic inside a service, which §1 puts in the wrong
 * place — this is a number that matters and it now has a test.
 *
 * Every one-rep-max formula is a fit to a population and none of them is
 * true of an individual, so the figure is only ever compared against itself.
 * Rounded to a tenth: three decimals would imply a precision the formula has
 * no claim to.
 */
export function estimated1RM(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export type ScoredSet = {
  exerciseId: number;
  exerciseName: string;
  weightKg: number;
  reps: number;
  /** ISO instant. Used only to say when, never to order the comparison. */
  performedAt: string;
};

export type Best = {
  weightKg: number;
  reps: number;
  estimated1rm: number;
  performedAt: string;
};

export type ExerciseBests = {
  exerciseId: number;
  exerciseName: string;
  heaviest: Best;
  strongest: Best;
};

export type RecordKind = 'heaviest' | 'strongest';

const toBest = (set: ScoredSet): Best => ({
  weightKg: set.weightKg,
  reps: set.reps,
  estimated1rm: estimated1RM(set.weightKg, set.reps),
  performedAt: set.performedAt,
});

/**
 * The best set of each kind, per exercise.
 *
 * A tie keeps the earlier set. Somebody who matches a record has not broken
 * it, and dating it to today would quietly erase when the work was actually
 * done.
 */
export function bestsByExercise(sets: ScoredSet[]): ExerciseBests[] {
  const byExercise = new Map<number, ExerciseBests>();

  for (const set of sets) {
    // A set with no reps is a set that was not performed.
    if (set.reps <= 0) continue;

    const scored = toBest(set);
    const existing = byExercise.get(set.exerciseId);

    if (!existing) {
      byExercise.set(set.exerciseId, {
        exerciseId: set.exerciseId,
        exerciseName: set.exerciseName,
        heaviest: scored,
        strongest: scored,
      });
      continue;
    }

    if (scored.weightKg > existing.heaviest.weightKg) existing.heaviest = scored;
    if (scored.estimated1rm > existing.strongest.estimated1rm) existing.strongest = scored;
  }

  return [...byExercise.values()];
}

/**
 * Which records a set breaks, given what stood before it.
 *
 * `previous` must not already include this set — the caller reads the bests
 * before writing the set, because a set compared against a history containing
 * itself can never be a record.
 */
export function recordsBrokenBy(
  set: { weightKg: number; reps: number },
  previous: ExerciseBests | null,
): RecordKind[] {
  if (set.reps <= 0) return [];

  // The first set of a movement is not a record. There is nothing to beat,
  // and celebrating it would make the word mean nothing on the second.
  if (!previous) return [];

  const broken: RecordKind[] = [];
  if (set.weightKg > previous.heaviest.weightKg) broken.push('heaviest');
  if (estimated1RM(set.weightKg, set.reps) > previous.strongest.estimated1rm) {
    broken.push('strongest');
  }
  return broken;
}
