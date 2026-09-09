import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramWithSlots } from '../../api/types';
import {
  addDay,
  addSlot,
  draftFrom,
  firstProblem,
  moveSlot,
  removeDay,
  removeSlot,
  renameDay,
  replaceSlot,
  toSaveBody,
  updateSlot,
  type Draft,
} from '../programmeDraft';

const squat: Exercise = { id: 1, name: 'Back Squat', pattern: 'squat', equipment: [] };
const press: Exercise = { id: 2, name: 'Overhead Press', pattern: 'v_push', equipment: [] };
const row: Exercise = { id: 3, name: 'Seated Cable Row', pattern: 'h_pull', equipment: [] };

const slot = (exercise: Exercise) => ({
  exerciseId: exercise.id,
  exerciseName: exercise.name,
  sets: 3,
  repMin: 6,
  repMax: 12,
});

const draft = (): Draft => ({
  name: 'Mein Plan',
  days: [
    { code: 'PUSH', name: 'Push', slots: [slot(squat), slot(press)] },
    { code: 'PULL', name: 'Pull', slots: [slot(row)] },
  ],
});

describe('loading a programme into the editor', () => {
  it('keeps the code of every day that already exists', () => {
    const program: ProgramWithSlots = {
      id: 7,
      slug: 'own_1_abc',
      name: 'Mein Plan',
      description: 'Eigenes Programm',
      daysPerWeek: 1,
      mine: true,
      days: [
        {
          position: 0,
          code: 'PUSH',
          name: 'Push',
          slots: [
            {
              exerciseId: 2,
              exerciseName: 'Overhead Press',
              pattern: 'v_push',
              sets: 4,
              incrementKg: 2.5,
              restSeconds: 150,
              range: { min: 5, max: 8 },
            },
          ],
        },
      ],
    };

    expect(draftFrom(program).days[0]).toEqual({
      code: 'PUSH',
      name: 'Push',
      slots: [{ exerciseId: 2, exerciseName: 'Overhead Press', sets: 4, repMin: 5, repMax: 8 }],
    });
  });
});

describe('editing days', () => {
  it('renames a day without touching its code', () => {
    // The whole point: a code is what sessions were logged against. Renaming
    // Pull to Zug is a label change; moving the code would orphan March.
    const renamed = renameDay(draft(), 1, 'Zug');

    expect(renamed.days[1]).toMatchObject({ code: 'PULL', name: 'Zug' });
  });

  it('gives a new day no code at all', () => {
    const added = addDay(draft(), 'Beine');

    expect(added.days[2]).toEqual({ name: 'Beine', slots: [] });
    expect(added.days[2]).not.toHaveProperty('code');
  });

  it('removes the day it was asked for and no other', () => {
    const without = removeDay(draft(), 0);

    expect(without.days.map((day) => day.name)).toEqual(['Pull']);
  });

  it('stops at seven days', () => {
    let built: Draft = { name: 'x', days: [] };
    for (let n = 0; n < 9; n += 1) built = addDay(built, `Tag ${n}`);

    expect(built.days).toHaveLength(7);
  });

  it('leaves the original alone', () => {
    const before = draft();
    renameDay(before, 0, 'Something else');

    expect(before.days[0]!.name).toBe('Push');
  });
});

describe('editing the movements of a day', () => {
  it('adds to the end of the right day', () => {
    const added = addSlot(draft(), 1, press);

    expect(added.days[1]!.slots.map((s) => s.exerciseName)).toEqual([
      'Seated Cable Row',
      'Overhead Press',
    ]);
    expect(added.days[0]!.slots).toHaveLength(2);
  });

  it('swaps the movement but keeps the sets and reps set for it', () => {
    const tuned = updateSlot(draft(), 0, 0, { sets: 5, repMin: 3, repMax: 5 });
    const swapped = replaceSlot(tuned, 0, 0, row);

    expect(swapped.days[0]!.slots[0]).toEqual({
      exerciseId: 3,
      exerciseName: 'Seated Cable Row',
      sets: 5,
      repMin: 3,
      repMax: 5,
    });
  });

  it('moves a movement up past the one above it', () => {
    const moved = moveSlot(draft(), 0, 1, -1);

    expect(moved.days[0]!.slots.map((s) => s.exerciseName)).toEqual([
      'Overhead Press',
      'Back Squat',
    ]);
  });

  it('does nothing at either end rather than dropping a movement', () => {
    // The bug this guards: an out-of-range swap that reads undefined and
    // leaves a hole where an exercise was.
    const start = draft();

    expect(moveSlot(start, 0, 0, -1)).toEqual(start);
    expect(moveSlot(start, 0, 1, 1)).toEqual(start);
  });

  it('removes by index within the day', () => {
    const without = removeSlot(draft(), 0, 0);

    expect(without.days[0]!.slots.map((s) => s.exerciseName)).toEqual(['Overhead Press']);
  });
});

describe('what stands between a draft and a save', () => {
  it('is nothing, when the draft is fine', () => {
    expect(firstProblem(draft())).toBeNull();
  });

  it('catches a programme with no name', () => {
    expect(firstProblem({ ...draft(), name: '   ' })).toBe('name_missing');
  });

  it('catches a day with nothing in it', () => {
    expect(firstProblem(addDay(draft(), 'Beine'))).toBe('day_empty');
  });

  it('catches an unnamed day before an empty one', () => {
    expect(firstProblem({ name: 'x', days: [{ name: '', slots: [] }] })).toBe('day_name_missing');
  });

  it('catches the same movement twice in one day', () => {
    const twice = addSlot(draft(), 0, squat);

    expect(firstProblem(twice)).toBe('duplicate_exercise');
  });
});

describe('what gets sent', () => {
  it('sends ids and codes, not names it made up', () => {
    const body = toSaveBody(addDay(draft(), '  Beine  '));

    expect(body.days[0]).toEqual({
      code: 'PUSH',
      name: 'Push',
      slots: [
        { exerciseId: 1, sets: 3, repMin: 6, repMax: 12 },
        { exerciseId: 2, sets: 3, repMin: 6, repMax: 12 },
      ],
    });
    // A new day carries no code: the server derives one, once, and it then
    // belongs to that day's history rather than to this form.
    expect(body.days[2]).toEqual({ name: 'Beine', slots: [] });
  });

  it('trims the programme name', () => {
    expect(toSaveBody({ name: '  Mein Plan  ', days: [] }).name).toBe('Mein Plan');
  });
});
