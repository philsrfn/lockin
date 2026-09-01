import { describe, expect, it } from 'vitest';
import {
  type PerformedSet,
  jointPainGate,
  nextPrescription,
  rampIn,
  roundToIncrement,
} from '../progression';

const RANGE = { min: 6, max: 12 };

/** sets([90, 12], [90, 12], [90, 10]) */
function sets(...specs: [weight: number, reps: number, rir?: number][]): PerformedSet[] {
  return specs.map(([weightKg, reps, rir]) => ({ weightKg, reps, rir: rir ?? null }));
}

function prescribe(history: PerformedSet[][], overrides: Partial<Parameters<typeof nextPrescription>[0]> = {}) {
  return nextPrescription({
    exerciseId: 1,
    history,
    range: RANGE,
    incrementKg: 2.5,
    targetSets: 3,
    ...overrides,
  });
}

describe('roundToIncrement', () => {
  it('rounds to the nearest plate jump by default', () => {
    expect(roundToIncrement(81, 2.5)).toBe(80);
    expect(roundToIncrement(81.5, 2.5)).toBe(82.5);
    expect(roundToIncrement(12.4, 1.25)).toBe(12.5);
  });

  it('rounds down when asked, so a deload is always a deload', () => {
    expect(roundToIncrement(78.75, 2.5, 'down')).toBe(77.5);
    expect(roundToIncrement(80, 2.5, 'down')).toBe(80);
  });

  it('leaves no floating point dust', () => {
    expect(roundToIncrement(11.25 + 1.25, 1.25)).toBe(12.5);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe('nextPrescription', () => {
  it('asks for the top of the range at an unknown weight the first time', () => {
    const p = prescribe([]);
    expect(p.reason).toBe('first_time');
    expect(p.weightKg).toBeNull();
    expect(p.targetReps).toBe(RANGE.max);
    expect(p.sets).toBe(3);
  });

  it('adds weight and drops to the bottom of the range once every set hits the top', () => {
    const p = prescribe([sets([90, 12], [90, 12], [90, 12])]);
    expect(p.reason).toBe('increase_load');
    expect(p.weightKg).toBe(92.5);
    expect(p.targetReps).toBe(6);
  });

  it('holds the weight and asks for one more rep when the worst set is short', () => {
    const p = prescribe([sets([90, 12], [90, 12], [90, 10])]);
    expect(p.reason).toBe('increase_reps');
    expect(p.weightKg).toBe(90);
    expect(p.targetReps).toBe(11);
  });

  it('does not add weight when he stopped short of the prescribed set count', () => {
    const p = prescribe([sets([90, 12], [90, 12])]);
    expect(p.reason).toBe('hold');
    expect(p.weightKg).toBe(90);
    expect(p.targetReps).toBe(12);
  });

  it('anchors on the lightest set when the weight dropped mid-exercise', () => {
    const p = prescribe([sets([90, 12], [90, 12], [87.5, 12])]);
    expect(p.reason).toBe('hold');
    expect(p.weightKg).toBe(87.5);
    expect(p.targetReps).toBe(12);
  });

  it('adds weight when he blew past the top of the range', () => {
    const p = prescribe([sets([90, 14], [90, 13], [90, 13])]);
    expect(p.reason).toBe('increase_load');
    expect(p.weightKg).toBe(92.5);
    expect(p.targetReps).toBe(6);
  });

  it('deloads after two sessions that both missed the bottom of the range', () => {
    const p = prescribe([
      sets([90, 5], [90, 4], [90, 4]),
      sets([90, 5], [90, 5], [90, 4]),
    ]);
    expect(p.reason).toBe('deload');
    expect(p.weightKg).toBe(80); // 90 * 0.9 = 81, rounded down to a 2.5 jump
    expect(p.targetReps).toBe(6);
  });

  it('does not deload after a single bad session', () => {
    const p = prescribe([
      sets([90, 5], [90, 4], [90, 4]),
      sets([90, 8], [90, 8], [90, 7]),
    ]);
    expect(p.reason).not.toBe('deload');
    expect(p.weightKg).toBe(90);
  });

  it('refuses to add weight while a joint pain flag is standing', () => {
    const p = prescribe([sets([90, 12], [90, 12], [90, 12])], {
      gate: { consecutiveFlags: 1, holdLoad: true, reduceLoadPct: 0, recommendDoctor: false },
    });
    expect(p.reason).toBe('hold');
    expect(p.weightKg).toBe(90);
  });

  it('cuts load when joint pain has been flagged twice running', () => {
    const p = prescribe([sets([90, 12], [90, 12], [90, 12])], {
      gate: { consecutiveFlags: 2, holdLoad: true, reduceLoadPct: 20, recommendDoctor: true },
    });
    expect(p.reason).toBe('joint_pain');
    expect(p.weightKg).toBe(70); // 90 * 0.8 = 72, rounded down to a 2.5 jump
    expect(p.targetReps).toBe(6);
  });

  it('honours the ramp-in set cap', () => {
    const p = prescribe([sets([90, 12], [90, 12], [90, 12])], { targetSets: 2 });
    expect(p.sets).toBe(2);
  });

  it('ignores sessions in which the exercise was not performed', () => {
    const p = prescribe([[], sets([90, 12], [90, 12], [90, 12])]);
    expect(p.reason).toBe('increase_load');
    expect(p.weightKg).toBe(92.5);
  });
});

describe('rampIn', () => {
  const now = new Date('2026-09-15T10:00:00Z');

  it('is active before the first session is ever logged', () => {
    expect(rampIn(null, now)).toEqual({ active: true, maxWorkingSets: 2, minRir: 3 });
  });

  it('is active for the first two weeks of training', () => {
    expect(rampIn(new Date('2026-09-12T10:00:00Z'), now).active).toBe(true);
    expect(rampIn(new Date('2026-09-02T10:00:00Z'), now).active).toBe(true);
  });

  it('ends at fourteen days', () => {
    const gate = rampIn(new Date('2026-09-01T10:00:00Z'), now);
    expect(gate).toEqual({ active: false, maxWorkingSets: null, minRir: 1 });
  });

  it('stays off once training is established', () => {
    expect(rampIn(new Date('2026-06-01T10:00:00Z'), now).active).toBe(false);
  });
});

describe('jointPainGate', () => {
  const session = (jointPain: boolean, day: number) => ({
    performedAt: new Date(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`),
    jointPain,
  });

  it('does nothing with no history', () => {
    expect(jointPainGate([])).toEqual({
      consecutiveFlags: 0,
      holdLoad: false,
      reduceLoadPct: 0,
      recommendDoctor: false,
    });
  });

  it('holds load after one flagged session but does not send him to a doctor', () => {
    const gate = jointPainGate([session(true, 10)]);
    expect(gate.consecutiveFlags).toBe(1);
    expect(gate.holdLoad).toBe(true);
    expect(gate.reduceLoadPct).toBe(0);
    expect(gate.recommendDoctor).toBe(false);
  });

  it('cuts load and recommends a doctor after two consecutive flagged sessions', () => {
    const gate = jointPainGate([session(true, 12), session(true, 10)]);
    expect(gate.consecutiveFlags).toBe(2);
    expect(gate.reduceLoadPct).toBe(20);
    expect(gate.recommendDoctor).toBe(true);
  });

  it('keeps recommending a doctor while the streak continues', () => {
    const gate = jointPainGate([session(true, 14), session(true, 12), session(true, 10)]);
    expect(gate.consecutiveFlags).toBe(3);
    expect(gate.recommendDoctor).toBe(true);
  });

  it('clears once a clean session is logged', () => {
    const gate = jointPainGate([session(false, 14), session(true, 12), session(true, 10)]);
    expect(gate.consecutiveFlags).toBe(0);
    expect(gate.holdLoad).toBe(false);
    expect(gate.recommendDoctor).toBe(false);
  });

  it('sorts by date rather than trusting the order handed in', () => {
    const gate = jointPainGate([session(true, 10), session(true, 12), session(false, 14)]);
    expect(gate.consecutiveFlags).toBe(0);
  });
});
