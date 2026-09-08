import { describe, expect, it } from 'vitest';
import { bestsByExercise, estimated1RM, recordsBrokenBy } from '../records';

const set = (weightKg: number, reps: number, performedAt = '2026-08-01T17:00:00Z') => ({
  exerciseId: 1,
  exerciseName: 'Back Squat',
  weightKg,
  reps,
  performedAt,
});

describe('estimating a one-rep max', () => {
  it('is the lifted weight at a single rep, near enough', () => {
    expect(estimated1RM(100, 1)).toBeCloseTo(103.3, 1);
  });

  it('rewards reps, which is the point of using it at all', () => {
    expect(estimated1RM(90, 8)).toBeGreaterThan(estimated1RM(100, 3));
  });

  it('is nothing for a set that was not performed', () => {
    expect(estimated1RM(100, 0)).toBe(0);
  });
});

describe('the best sets of each exercise', () => {
  it('separates the heaviest from the strongest, because they disagree', () => {
    // A hard triple at 110 is the heaviest. Eight at 100 is the better set:
    // it is a higher estimated max, and it is the one that says he improved.
    const [bests] = bestsByExercise([set(110, 3), set(100, 8)]);

    expect(bests?.heaviest).toMatchObject({ weightKg: 110, reps: 3 });
    expect(bests?.strongest).toMatchObject({ weightKg: 100, reps: 8 });
  });

  it('keeps one entry per exercise', () => {
    const bench = { ...set(80, 5), exerciseId: 2, exerciseName: 'Barbell Bench Press' };
    const bests = bestsByExercise([set(100, 5), bench, set(105, 5)]);

    expect(bests).toHaveLength(2);
    expect(bests.find((b) => b.exerciseId === 1)?.heaviest.weightKg).toBe(105);
  });

  it('keeps the earlier of two equal sets', () => {
    // Matching a record is not breaking it, and re-dating it would erase when
    // the work was actually done.
    const [bests] = bestsByExercise([
      set(100, 5, '2026-07-01T17:00:00Z'),
      set(100, 5, '2026-08-01T17:00:00Z'),
    ]);

    expect(bests?.heaviest.performedAt).toBe('2026-07-01T17:00:00Z');
  });

  it('ignores a set with no reps in it', () => {
    expect(bestsByExercise([set(200, 0)])).toEqual([]);
  });

  it('has nothing to say about somebody who has not lifted', () => {
    expect(bestsByExercise([])).toEqual([]);
  });
});

describe('what a set breaks', () => {
  const previous = bestsByExercise([set(100, 5)])[0]!;

  it('breaks the heaviest by adding weight', () => {
    expect(recordsBrokenBy({ weightKg: 102.5, reps: 3 }, previous)).toContain('heaviest');
  });

  it('breaks the strongest by adding reps at the same weight', () => {
    const broken = recordsBrokenBy({ weightKg: 100, reps: 7 }, previous);

    expect(broken).toEqual(['strongest']);
  });

  it('breaks both when the set is better on every count', () => {
    expect(recordsBrokenBy({ weightKg: 105, reps: 8 }, previous)).toEqual([
      'heaviest',
      'strongest',
    ]);
  });

  it('breaks nothing by matching', () => {
    expect(recordsBrokenBy({ weightKg: 100, reps: 5 }, previous)).toEqual([]);
  });

  it('breaks nothing on a heavier bar for fewer reps, when the max is lower', () => {
    // 105 × 2 is heavier but a worse set. It takes the weight record and not
    // the strength one, which is exactly the distinction worth drawing.
    expect(recordsBrokenBy({ weightKg: 105, reps: 2 }, previous)).toEqual(['heaviest']);
  });

  it('calls the first set of a movement no record at all', () => {
    // Nothing to beat. Celebrating it would make the word mean nothing the
    // second time.
    expect(recordsBrokenBy({ weightKg: 100, reps: 5 }, null)).toEqual([]);
  });
});
