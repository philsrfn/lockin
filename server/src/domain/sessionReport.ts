/**
 * What a session was, in numbers, decided here and nowhere else.
 *
 * §1: the trainer writes the sentence, this writes the figures it is allowed
 * to use. A model that is handed "your volume rose 8%" will say so; a model
 * that is handed the sets and asked to work it out will sometimes say 12%,
 * and be believed, because it says it in the same confident voice.
 *
 * WHAT VOLUME IS AND IS NOT
 *
 * Volume here is the sum of weight times reps, which is the crudest useful
 * measure of how much work a session contained. It is deliberately not the
 * headline. It says nothing at all about a set of pull-ups — bodyweight is
 * not in the sets table, so the load is zero — and it rewards a long sloppy
 * session over a short heavy one. It earns its place only as a comparison
 * against the same athlete doing the same day a week ago, which is the only
 * way it is used below.
 *
 * WHAT IS ABSENT RATHER THAN GUESSED
 *
 * Three fields are nullable on purpose, and the null is the answer:
 *
 *   `versusLast` — there was no previous outing of this day. A first session
 *   has nothing to be better than.
 *
 *   `plan` — a free session had no prescription, so "did you do what was
 *   planned" is not a question that was asked. Filling it in with the sets
 *   that happened would make every free session a perfect one.
 *
 *   `inRange` — same reason, per exercise.
 *
 * `domain/expenditure.ts` made the same choice for the same reason: a trainer
 * that answers when it does not know is worse than one that says it does not.
 */
import { type ExerciseBests, type RecordKind, estimated1RM, recordsBrokenBy } from './records';

export type ReportSet = {
  exerciseId: number;
  exerciseName: string;
  weightKg: number;
  reps: number;
};

/** The same exercise, the last time before this session that it was trained. */
export type PreviousOuting = {
  exerciseId: number;
  performedAt: string;
  sets: ReportSet[];
};

/** What the programme asked for, when the session came from a programme day. */
export type Prescribed = {
  exerciseId: number;
  sets: number;
  range: { min: number; max: number };
};

export type ExerciseFacts = {
  exerciseId: number;
  name: string;
  sets: number;
  reps: number;
  volumeKg: number;
  /** Heaviest set of this session. Ties keep the one with more reps. */
  topSet: { weightKg: number; reps: number };
  previous: { performedAt: string; topSet: { weightKg: number; reps: number }; volumeKg: number } | null;
  /** Change in the heaviest load carried, against the last outing. */
  loadDeltaKg: number | null;
  /**
   * Change in estimated max against the last outing. The honest measure of
   * "did this go better": it catches the same weight for two more reps, which
   * `loadDeltaKg` reports as standing still.
   */
  estimatedMaxDeltaKg: number | null;
  volumeDeltaKg: number | null;
  /** Every working set landed inside the prescribed rep range. */
  inRange: boolean | null;
};

export type SessionFacts = {
  totalSets: number;
  totalReps: number;
  volumeKg: number;
  exerciseCount: number;
  exercises: ExerciseFacts[];
  versusLast: {
    performedAt: string;
    volumeKg: number;
    deltaKg: number;
    /** Rounded to a whole percent. A tenth of a percent of a gym session is noise. */
    deltaPct: number;
  } | null;
  records: { exerciseId: number; name: string; kind: RecordKind; weightKg: number; reps: number }[];
  plan: {
    exercisesPlanned: number;
    exercisesDone: number;
    setsPlanned: number;
    setsDone: number;
  } | null;
};

/** Kilos to one decimal. Bars go up in 1.25s; three decimals are noise. */
const kg = (value: number): number => Math.round(value * 10) / 10;

const volumeOf = (sets: ReportSet[]): number =>
  kg(sets.reduce((total, set) => total + set.weightKg * set.reps, 0));

/**
 * The set somebody would name if asked what they did on this movement today.
 *
 * Heaviest first, and a tie broken by reps — 100×8 is the better answer than
 * 100×5, and picking whichever came first in the array would make the report
 * depend on the order rows came back from Postgres.
 */
function topSetOf(sets: ReportSet[]): { weightKg: number; reps: number } | null {
  let best: ReportSet | null = null;

  for (const set of sets) {
    if (set.reps <= 0) continue;
    if (
      !best ||
      set.weightKg > best.weightKg ||
      (set.weightKg === best.weightKg && set.reps > best.reps)
    ) {
      best = set;
    }
  }

  return best ? { weightKg: best.weightKg, reps: best.reps } : null;
}

export function summariseSession(input: {
  sets: ReportSet[];
  previous: PreviousOuting[];
  /** The last time this same programme day was trained, closed out. */
  previousSession: { performedAt: string; sets: ReportSet[] } | null;
  /** Absent for a free session, which had no prescription to meet. */
  prescribed: Prescribed[] | null;
  /** Records as they stood *before* this session, or the session beats itself. */
  bestsBefore: ExerciseBests[];
}): SessionFacts {
  // A set of zero reps is a set that was started and abandoned. It counts
  // towards nothing, including the count of sets.
  const performed = input.sets.filter((set) => set.reps > 0);

  const byExercise = new Map<number, ReportSet[]>();
  for (const set of performed) {
    const forExercise = byExercise.get(set.exerciseId) ?? [];
    forExercise.push(set);
    byExercise.set(set.exerciseId, forExercise);
  }

  const previousFor = new Map(input.previous.map((outing) => [outing.exerciseId, outing]));
  const prescribedFor = new Map((input.prescribed ?? []).map((slot) => [slot.exerciseId, slot]));
  const bestsFor = new Map(input.bestsBefore.map((best) => [best.exerciseId, best]));

  const exercises: ExerciseFacts[] = [];

  for (const [exerciseId, sets] of byExercise) {
    const top = topSetOf(sets)!;
    const outing = previousFor.get(exerciseId) ?? null;
    const previousTop = outing ? topSetOf(outing.sets) : null;
    const slot = prescribedFor.get(exerciseId);

    exercises.push({
      exerciseId,
      name: sets[0]!.exerciseName,
      sets: sets.length,
      reps: sets.reduce((total, set) => total + set.reps, 0),
      volumeKg: volumeOf(sets),
      topSet: top,
      previous:
        outing && previousTop
          ? {
              performedAt: outing.performedAt,
              topSet: previousTop,
              volumeKg: volumeOf(outing.sets),
            }
          : null,
      loadDeltaKg: previousTop ? kg(top.weightKg - previousTop.weightKg) : null,
      estimatedMaxDeltaKg: previousTop
        ? kg(
            estimated1RM(top.weightKg, top.reps) -
              estimated1RM(previousTop.weightKg, previousTop.reps),
          )
        : null,
      volumeDeltaKg: outing ? kg(volumeOf(sets) - volumeOf(outing.sets)) : null,
      inRange: slot ? sets.every((set) => set.reps >= slot.range.min && set.reps <= slot.range.max) : null,
    });
  }

  // Ordered the way the session was performed, not by how well it went. The
  // report is a retelling, and a retelling that reorders is a ranking.
  const order = new Map(performed.map((set, index) => [set.exerciseId, index]));
  exercises.sort((a, b) => order.get(a.exerciseId)! - order.get(b.exerciseId)!);

  const volumeKg = volumeOf(performed);

  const records = exercises.flatMap((exercise) =>
    recordsBrokenBy(exercise.topSet, bestsFor.get(exercise.exerciseId) ?? null).map((kind) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      kind,
      weightKg: exercise.topSet.weightKg,
      reps: exercise.topSet.reps,
    })),
  );

  const lastVolume = input.previousSession ? volumeOf(input.previousSession.sets) : null;

  return {
    totalSets: performed.length,
    totalReps: performed.reduce((total, set) => total + set.reps, 0),
    volumeKg,
    exerciseCount: byExercise.size,
    exercises,
    versusLast:
      input.previousSession && lastVolume !== null
        ? {
            performedAt: input.previousSession.performedAt,
            volumeKg: lastVolume,
            deltaKg: kg(volumeKg - lastVolume),
            // A previous session of zero volume — every movement bodyweight —
            // has no percentage to be a share of. Zero beats Infinity on a
            // screen, and beats NaN everywhere.
            deltaPct: lastVolume > 0 ? Math.round(((volumeKg - lastVolume) / lastVolume) * 100) : 0,
          }
        : null,
    records,
    plan: input.prescribed
      ? {
          exercisesPlanned: input.prescribed.length,
          exercisesDone: input.prescribed.filter((slot) => byExercise.has(slot.exerciseId)).length,
          setsPlanned: input.prescribed.reduce((total, slot) => total + slot.sets, 0),
          setsDone: performed.length,
        }
      : null,
  };
}
