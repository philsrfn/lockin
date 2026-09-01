/**
 * Double progression, and the load gates that sit under it.
 *
 * Pure. No database, no clock, no io — every input is a parameter. Per §1 of
 * the spec this is where load is decided; the model never computes it.
 *
 * The rule: work a fixed weight up through the rep range across all working
 * sets. Once every set reaches the top of the range, add the smallest plate
 * jump and drop back to the bottom.
 */

export type RepRange = { min: number; max: number };

export const DEFAULT_REP_RANGE: RepRange = { min: 6, max: 12 };

export type PerformedSet = {
  weightKg: number;
  reps: number;
  rir: number | null;
};

export type PrescriptionReason =
  | 'first_time'
  | 'increase_load'
  | 'increase_reps'
  | 'hold'
  | 'deload'
  | 'joint_pain';

export type Prescription = {
  exerciseId: number;
  /** null only on `first_time` — he picks the working weight, we record it. */
  weightKg: number | null;
  sets: number;
  targetReps: number;
  reason: PrescriptionReason;
};

export type JointPainGate = {
  consecutiveFlags: number;
  /** Do not add weight while a flag is standing. */
  holdLoad: boolean;
  /** 0 unless the §7 two-session rule has tripped. */
  reduceLoadPct: number;
  recommendDoctor: boolean;
};

export const NO_JOINT_PAIN: JointPainGate = {
  consecutiveFlags: 0,
  holdLoad: false,
  reduceLoadPct: 0,
  recommendDoctor: false,
};

/** A failed session is one where the worst set fell short of the rep range. */
const DELOAD_FACTOR = 0.9;
const DELOAD_AFTER_FAILED_SESSIONS = 2;
const RAMP_IN_DAYS = 14;
const JOINT_PAIN_REDUCTION_PCT = 20;
const MS_PER_DAY = 86_400_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Snap a weight to something that exists on the rack. `down` is used for
 * deloads and joint-pain cuts, so that a reduction is never rounded back up
 * into an increase.
 */
export function roundToIncrement(
  value: number,
  increment: number,
  mode: 'nearest' | 'down' | 'up' = 'nearest',
): number {
  if (increment <= 0) return round2(value);
  const steps = value / increment;
  const epsilon = 1e-9;
  const snapped =
    mode === 'down'
      ? Math.floor(steps + epsilon)
      : mode === 'up'
        ? Math.ceil(steps - epsilon)
        : Math.round(steps);
  return round2(snapped * increment);
}

function worstReps(performed: PerformedSet[]): number {
  return Math.min(...performed.map((set) => set.reps));
}

function workingWeight(performed: PerformedSet[]): number {
  // The weight he completed every set at. If the load dropped mid-exercise,
  // the lighter weight is the honest anchor for next time.
  return Math.min(...performed.map((set) => set.weightKg));
}

function shouldDeload(sessions: PerformedSet[][], range: RepRange): boolean {
  const recent = sessions.slice(0, DELOAD_AFTER_FAILED_SESSIONS);
  if (recent.length < DELOAD_AFTER_FAILED_SESSIONS) return false;
  return recent.every((performed) => worstReps(performed) < range.min);
}

export function nextPrescription(input: {
  exerciseId: number;
  /** Working sets for this exercise, one entry per session, most recent first. */
  history: PerformedSet[][];
  range?: RepRange;
  incrementKg: number;
  targetSets: number;
  gate?: JointPainGate;
}): Prescription {
  const { exerciseId, incrementKg, targetSets } = input;
  const range = input.range ?? DEFAULT_REP_RANGE;
  const gate = input.gate ?? NO_JOINT_PAIN;

  // Sessions where he trained something else entirely tell us nothing here.
  const sessions = input.history.filter((performed) => performed.length > 0);
  const last = sessions[0];

  if (!last) {
    return {
      exerciseId,
      weightKg: null,
      sets: targetSets,
      targetReps: range.max,
      reason: 'first_time',
    };
  }

  const weight = workingWeight(last);
  const minReps = worstReps(last);

  // §7: joint pain flagged twice running cuts load. Gated in code, not wording.
  if (gate.reduceLoadPct > 0) {
    return {
      exerciseId,
      weightKg: roundToIncrement(weight * (1 - gate.reduceLoadPct / 100), incrementKg, 'down'),
      sets: targetSets,
      targetReps: range.min,
      reason: 'joint_pain',
    };
  }

  if (shouldDeload(sessions, range)) {
    return {
      exerciseId,
      weightKg: roundToIncrement(weight * DELOAD_FACTOR, incrementKg, 'down'),
      sets: targetSets,
      targetReps: range.min,
      reason: 'deload',
    };
  }

  const everySetAtTop =
    last.length >= targetSets &&
    last.every((set) => set.reps >= range.max && set.weightKg === weight);

  if (everySetAtTop && !gate.holdLoad) {
    return {
      exerciseId,
      weightKg: roundToIncrement(weight + incrementKg, incrementKg),
      sets: targetSets,
      targetReps: range.min,
      reason: 'increase_load',
    };
  }

  const targetReps = Math.min(Math.max(minReps + 1, range.min), range.max);

  return {
    exerciseId,
    weightKg: weight,
    sets: targetSets,
    targetReps,
    reason: targetReps > minReps ? 'increase_reps' : 'hold',
  };
}

export type RampInGate = {
  active: boolean;
  /** null = no cap, the template decides. */
  maxWorkingSets: number | null;
  minRir: number;
};

/**
 * Returning from months of inactivity: connective tissue lags muscle, so the
 * first two weeks are capped at two working sets and kept well short of
 * failure. Derived from the first logged session rather than a stored date —
 * nothing to keep in sync, and "no sessions yet" is correctly ramp-in.
 */
export function rampIn(firstSessionAt: Date | null, now: Date): RampInGate {
  if (!firstSessionAt) {
    return { active: true, maxWorkingSets: 2, minRir: 3 };
  }
  const daysTraining = (now.getTime() - firstSessionAt.getTime()) / MS_PER_DAY;
  return daysTraining < RAMP_IN_DAYS
    ? { active: true, maxWorkingSets: 2, minRir: 3 }
    : { active: false, maxWorkingSets: null, minRir: 1 };
}

/**
 * §7: "If joint_pain = true on two consecutive sessions, the trainer must
 * reduce load and recommend seeing a doctor." One flag holds the load without
 * cutting it — a single sore knee is not an injury, but it is not a day to add
 * weight either.
 */
export function jointPainGate(
  sessions: { performedAt: Date; jointPain: boolean }[],
): JointPainGate {
  const newestFirst = [...sessions].sort(
    (a, b) => b.performedAt.getTime() - a.performedAt.getTime(),
  );

  let consecutiveFlags = 0;
  for (const session of newestFirst) {
    if (!session.jointPain) break;
    consecutiveFlags += 1;
  }

  const tripped = consecutiveFlags >= 2;
  return {
    consecutiveFlags,
    holdLoad: consecutiveFlags >= 1,
    reduceLoadPct: tripped ? JOINT_PAIN_REDUCTION_PCT : 0,
    recommendDoctor: tripped,
  };
}
