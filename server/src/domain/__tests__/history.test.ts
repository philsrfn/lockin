import { describe, expect, it } from 'vitest';
import { groupTrainingByDay, summariseSets } from '../history';

const session = (id: number, performedAt: string) => ({ id, performedAt });
const set = (exerciseId: number, exerciseName: string, weightKg: number, reps: number) => ({
  exerciseId,
  exerciseName,
  weightKg,
  reps,
});

describe('grouping past training into days', () => {
  const zone = 'Europe/Berlin';

  it('puts a day at the top when it is the most recent', () => {
    const days = groupTrainingByDay(
      zone,
      [session(1, '2026-09-01T17:00:00Z'), session(2, '2026-09-03T17:00:00Z')],
      [],
    );

    expect(days.map((entry) => entry.day)).toEqual(['2026-09-03', '2026-09-01']);
  });

  it('puts a lift and a run on the same day together', () => {
    const days = groupTrainingByDay(
      zone,
      [session(1, '2026-09-03T08:00:00Z')],
      [session(9, '2026-09-03T18:00:00Z')],
    );

    expect(days).toHaveLength(1);
    expect(days[0]?.sessions.map((s) => s.id)).toEqual([1]);
    expect(days[0]?.cardio.map((c) => c.id)).toEqual([9]);
  });

  it('skips the days nothing happened in, because most days are rest days', () => {
    const days = groupTrainingByDay(
      zone,
      [session(1, '2026-09-01T17:00:00Z'), session(2, '2026-09-08T17:00:00Z')],
      [],
    );

    expect(days).toHaveLength(2);
  });

  it('files a session by the athlete\'s day, not the server\'s', () => {
    // 22:30 UTC on the 3rd is already 00:30 on the 4th in Berlin. Filing this
    // under the 3rd would show somebody a session on a day they did not train.
    const late = [session(1, '2026-09-03T22:30:00Z')];

    expect(groupTrainingByDay('Europe/Berlin', late, [])[0]?.day).toBe('2026-09-04');
    expect(groupTrainingByDay('UTC', late, [])[0]?.day).toBe('2026-09-03');
  });

  it('runs newest first inside a day as well as between them', () => {
    const days = groupTrainingByDay(
      zone,
      [session(1, '2026-09-03T08:00:00Z'), session(2, '2026-09-03T19:00:00Z')],
      [],
    );

    expect(days[0]?.sessions.map((s) => s.id)).toEqual([2, 1]);
  });

  it('has nothing to say about somebody who has never trained', () => {
    expect(groupTrainingByDay(zone, [], [])).toEqual([]);
  });
});

describe('reducing a session to a readable row', () => {
  it('counts the sets and sums the volume', () => {
    const summary = summariseSets([
      set(1, 'Back Squat', 90, 8),
      set(1, 'Back Squat', 90, 8),
      set(2, 'Lat Pulldown', 60, 10),
    ]);

    expect(summary.setCount).toBe(3);
    expect(summary.totalVolumeKg).toBe(90 * 8 + 90 * 8 + 60 * 10);
  });

  it('rounds the volume once at the end, not once per set', () => {
    // Six sets that each contribute a third of a kilo. Rounding per set would
    // lose two kilos; rounding once loses nothing worth seeing.
    const summary = summariseSets(Array.from({ length: 6 }, () => set(1, 'Curl', 20.5, 11)));

    expect(summary.totalVolumeKg).toBe(Math.round(20.5 * 11 * 6));
  });

  it('takes the heaviest set as the top set, not the last one', () => {
    // A back-off set after the working weight is not the number you look for.
    const summary = summariseSets([
      set(1, 'Back Squat', 90, 5),
      set(1, 'Back Squat', 70, 12),
    ]);

    expect(summary.exercises[0]).toMatchObject({ topWeightKg: 90, topReps: 5, sets: 2 });
  });

  it('breaks a tie at the same weight with the better set', () => {
    const summary = summariseSets([
      set(1, 'Back Squat', 90, 6),
      set(1, 'Back Squat', 90, 9),
      set(1, 'Back Squat', 90, 7),
    ]);

    expect(summary.exercises[0]).toMatchObject({ topWeightKg: 90, topReps: 9 });
  });

  it('keeps the exercises in the order they were performed', () => {
    const summary = summariseSets([
      set(3, 'Leg Press', 200, 10),
      set(1, 'Back Squat', 90, 8),
      set(3, 'Leg Press', 200, 10),
    ]);

    expect(summary.exercises.map((e) => e.exerciseName)).toEqual(['Leg Press', 'Back Squat']);
  });

  it('summarises an empty session as empty rather than as a zero-weight set', () => {
    expect(summariseSets([])).toEqual({ setCount: 0, totalVolumeKg: 0, exercises: [] });
  });
});
