import { describe, expect, it } from 'vitest';
import type { SetRecord } from '../../api/types';
import { setsByExercise } from '../setsByExercise';

const set = (id: number, exerciseId: number, setIndex: number): SetRecord => ({
  id,
  exerciseId,
  exerciseName: exerciseId === 1 ? 'Bench press' : exerciseId === 2 ? 'Row' : 'Squat',
  setIndex,
  weightKg: 80,
  reps: 8,
  rir: null,
});

describe('the sets of a session, as somebody remembers them', () => {
  it('keeps every set of one movement together', () => {
    // The server orders by set index, which is per movement — so a session
    // with two exercises arrives as 1A 1B 2A 2B, and the history read like a
    // superset nobody did.
    const groups = setsByExercise([set(1, 1, 1), set(2, 2, 1), set(3, 1, 2), set(4, 2, 2)]);

    expect(groups.map((group) => group.exerciseName)).toEqual(['Bench press', 'Row']);
    expect(groups[0]?.sets.map((performed) => performed.id)).toEqual([1, 3]);
    expect(groups[1]?.sets.map((performed) => performed.id)).toEqual([2, 4]);
  });

  it('puts the movements in the order they were first trained', () => {
    const groups = setsByExercise([set(1, 3, 1), set(2, 1, 1), set(3, 3, 2)]);

    expect(groups.map((group) => group.exerciseId)).toEqual([3, 1]);
  });

  it('decides which movement came first by when it was logged, not by where it arrived', () => {
    // Two first sets share an index, and the server's order between them is
    // whatever Postgres felt like. The id is the order they were written in.
    const groups = setsByExercise([set(5, 1, 1), set(2, 2, 1), set(6, 1, 2)]);

    expect(groups.map((group) => group.exerciseId)).toEqual([2, 1]);
  });

  it('orders the sets within a movement by their index', () => {
    const groups = setsByExercise([set(1, 1, 2), set(2, 1, 1), set(3, 1, 3)]);

    expect(groups[0]?.sets.map((performed) => performed.setIndex)).toEqual([1, 2, 3]);
  });

  it('has nothing to group in an empty session', () => {
    expect(setsByExercise([])).toEqual([]);
  });
});
