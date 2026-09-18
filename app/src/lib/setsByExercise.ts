import type { SetRecord } from '../api/types';

export type ExerciseSets = {
  exerciseId: number;
  exerciseName: string;
  sets: SetRecord[];
};

/**
 * A session's sets, one movement at a time.
 *
 * The server sends them ordered by set index, and the index counts per
 * movement — so two exercises arrive as bench 1, row 1, bench 2, row 2. That
 * is how the rows sit in the table, not how anybody trained or remembers it:
 * you did your bench, then you rowed.
 *
 * Movements come in the order they were first logged, by id rather than by
 * position. Two first sets share an index, the server's order between them is
 * unspecified, and the id is the one thing that records which was written
 * first.
 */
export function setsByExercise(sets: readonly SetRecord[]): ExerciseSets[] {
  const groups = new Map<number, ExerciseSets & { firstId: number }>();

  for (const performed of sets) {
    const group = groups.get(performed.exerciseId);
    if (group) {
      group.sets.push(performed);
      group.firstId = Math.min(group.firstId, performed.id);
    } else {
      groups.set(performed.exerciseId, {
        exerciseId: performed.exerciseId,
        exerciseName: performed.exerciseName,
        sets: [performed],
        firstId: performed.id,
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.firstId - b.firstId)
    .map(({ exerciseId, exerciseName, sets: grouped }) => ({
      exerciseId,
      exerciseName,
      sets: [...grouped].sort((a, b) => a.setIndex - b.setIndex),
    }));
}
