import { describe, expect, it } from 'vitest';
import { type ReportSet, summariseSession } from '../sessionReport';

const set = (exerciseId: number, name: string, weightKg: number, reps: number): ReportSet => ({
  exerciseId,
  exerciseName: name,
  weightKg,
  reps,
});

const squat = (weightKg: number, reps: number) => set(1, 'Back Squat', weightKg, reps);
const press = (weightKg: number, reps: number) => set(2, 'Bench Press', weightKg, reps);

const bare = {
  previous: [],
  previousSession: null,
  prescribed: null,
  bestsBefore: [],
};

describe('counting what happened', () => {
  it('counts sets, reps and volume', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(100, 5), squat(100, 5), press(60, 10)],
    });

    expect(facts.totalSets).toBe(3);
    expect(facts.totalReps).toBe(20);
    expect(facts.volumeKg).toBe(1600);
    expect(facts.exerciseCount).toBe(2);
  });

  it('does not count a set that was abandoned at zero reps', () => {
    // Somebody unracked, thought better of it, and logged it honestly. That
    // is not a set, and counting it would make the session look longer than
    // it was.
    const facts = summariseSession({ ...bare, sets: [squat(100, 5), squat(100, 0)] });

    expect(facts.totalSets).toBe(1);
    expect(facts.exercises[0]!.sets).toBe(1);
  });

  it('names the heaviest set, and breaks a tie on reps', () => {
    const facts = summariseSession({ ...bare, sets: [squat(100, 5), squat(100, 8), squat(95, 12)] });

    expect(facts.exercises[0]!.topSet).toEqual({ weightKg: 100, reps: 8 });
  });

  it('keeps the exercises in the order they were trained', () => {
    // Not ordered by how well each went. A report is a retelling.
    const facts = summariseSession({ ...bare, sets: [press(60, 10), squat(100, 5)] });

    expect(facts.exercises.map((e) => e.name)).toEqual(['Bench Press', 'Back Squat']);
  });

  it('survives a session of nothing but bodyweight', () => {
    const facts = summariseSession({ ...bare, sets: [set(3, 'Pull-up', 0, 8), set(3, 'Pull-up', 0, 7)] });

    expect(facts.volumeKg).toBe(0);
    expect(facts.totalReps).toBe(15);
    expect(facts.totalSets).toBe(2);
  });
});

describe('against the last time', () => {
  it('reports the load going up', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(102.5, 5)],
      previous: [{ exerciseId: 1, performedAt: '2026-09-07T17:00:00.000Z', sets: [squat(100, 5)] }],
    });

    expect(facts.exercises[0]!.loadDeltaKg).toBe(2.5);
  });

  it('sees the same weight for more reps as progress, which the load alone does not', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(100, 8)],
      previous: [{ exerciseId: 1, performedAt: '2026-09-07T17:00:00.000Z', sets: [squat(100, 5)] }],
    });

    expect(facts.exercises[0]!.loadDeltaKg).toBe(0);
    expect(facts.exercises[0]!.estimatedMaxDeltaKg).toBeGreaterThan(0);
  });

  it('says nothing rather than guessing when a movement is new', () => {
    const facts = summariseSession({ ...bare, sets: [squat(100, 5)] });

    expect(facts.exercises[0]!.previous).toBeNull();
    expect(facts.exercises[0]!.loadDeltaKg).toBeNull();
    expect(facts.exercises[0]!.estimatedMaxDeltaKg).toBeNull();
  });

  it('compares the whole session against the last outing of the same day', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(100, 5), squat(100, 5)],
      previousSession: {
        performedAt: '2026-09-07T17:00:00.000Z',
        sets: [squat(100, 5), squat(90, 5)],
      },
    });

    expect(facts.versusLast).toMatchObject({ volumeKg: 950, deltaKg: 50, deltaPct: 5 });
  });

  it('has no percentage to offer when the last outing carried no load', () => {
    // Every movement bodyweight. Zero on the screen beats Infinity, and beats
    // NaN everywhere.
    const facts = summariseSession({
      ...bare,
      sets: [set(3, 'Pull-up', 0, 8)],
      previousSession: { performedAt: '2026-09-07T17:00:00.000Z', sets: [set(3, 'Pull-up', 0, 8)] },
    });

    expect(facts.versusLast!.deltaPct).toBe(0);
  });

  it('leaves the comparison out entirely for a first session', () => {
    expect(summariseSession({ ...bare, sets: [squat(100, 5)] }).versusLast).toBeNull();
  });
});

describe('what the plan asked for', () => {
  it('counts what was planned against what was done', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(100, 5), squat(100, 5)],
      prescribed: [
        { exerciseId: 1, sets: 3, range: { min: 5, max: 8 } },
        { exerciseId: 2, sets: 3, range: { min: 8, max: 12 } },
      ],
    });

    expect(facts.plan).toEqual({
      exercisesPlanned: 2,
      exercisesDone: 1,
      setsPlanned: 6,
      setsDone: 2,
    });
  });

  it('marks an exercise out of range when one set fell short', () => {
    const facts = summariseSession({
      ...bare,
      sets: [squat(100, 6), squat(100, 4)],
      prescribed: [{ exerciseId: 1, sets: 2, range: { min: 5, max: 8 } }],
    });

    expect(facts.exercises[0]!.inRange).toBe(false);
  });

  it('refuses the question entirely for a free session', () => {
    // A session with no prescription cannot have met one. Filling this in
    // from the sets that happened would make every free session perfect.
    const facts = summariseSession({ ...bare, sets: [squat(100, 5)] });

    expect(facts.plan).toBeNull();
    expect(facts.exercises[0]!.inRange).toBeNull();
  });
});

describe('records', () => {
  const bests = [
    {
      exerciseId: 1,
      exerciseName: 'Back Squat',
      heaviest: { weightKg: 100, reps: 5, estimated1rm: 116.7, performedAt: '2026-09-07T17:00:00.000Z' },
      strongest: { weightKg: 100, reps: 5, estimated1rm: 116.7, performedAt: '2026-09-07T17:00:00.000Z' },
    },
  ];

  it('names the movement a record was set on', () => {
    const facts = summariseSession({ ...bare, sets: [squat(105, 5)], bestsBefore: bests });

    expect(facts.records).toEqual([
      { exerciseId: 1, name: 'Back Squat', kind: 'heaviest', weightKg: 105, reps: 5 },
      { exerciseId: 1, name: 'Back Squat', kind: 'strongest', weightKg: 105, reps: 5 },
    ]);
  });

  it('does not call matching a record breaking one', () => {
    const facts = summariseSession({ ...bare, sets: [squat(100, 5)], bestsBefore: bests });

    expect(facts.records).toEqual([]);
  });

  it('celebrates nothing on the first outing of a movement', () => {
    // There is nothing to beat, and calling it a record would make the word
    // mean nothing on the second.
    const facts = summariseSession({ ...bare, sets: [press(60, 10)], bestsBefore: bests });

    expect(facts.records).toEqual([]);
  });
});
