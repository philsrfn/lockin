import { describe, expect, it } from 'vitest';
import type { Exercise, ProgramWithSlots } from '../../api/types';
import {
  INCREMENTS_KG,
  REST_SECONDS,
  addDay,
  addSlot,
  draftFrom,
  firstProblem,
  reorderSlot,
  removeDay,
  removeSlot,
  renameDay,
  replaceSlot,
  toSaveBody,
  updateSlot,
  type Draft,
} from '../programmeDraft';

const squat: Exercise = { id: 1, name: 'Back Squat', pattern: 'squat', equipment: [], custom: false };
const press: Exercise = {
  id: 2,
  name: 'Overhead Press',
  pattern: 'v_push',
  equipment: [],
  custom: false,
};
const row: Exercise = {
  id: 3,
  name: 'Seated Cable Row',
  pattern: 'h_pull',
  equipment: [],
  custom: false,
};

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
      slots: [
        {
          exerciseId: 2,
          exerciseName: 'Overhead Press',
          sets: 4,
          repMin: 5,
          repMax: 8,
          // Carried rather than dropped. They were being dropped, which is
          // why the editor could show a rest it then silently discarded.
          restSeconds: 150,
          incrementKg: 2.5,
        },
      ],
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

    expect(swapped.days[0]!.slots[0]).toMatchObject({
      exerciseId: 3,
      exerciseName: 'Seated Cable Row',
      sets: 5,
      repMin: 3,
      repMax: 5,
    });
  });

  it('does not carry a rest or an increment across a swap', () => {
    // Three sets of eight means the same thing on a cable fly as on a squat.
    // A 5 kg jump does not, and carrying it over is how a lateral raise ends
    // up prescribed in fives.
    const tuned = updateSlot(draft(), 0, 0, { restSeconds: 240, incrementKg: 5 });
    const swapped = replaceSlot(tuned, 0, 0, row);

    expect(swapped.days[0]!.slots[0]!.restSeconds).toBeUndefined();
    expect(swapped.days[0]!.slots[0]!.incrementKg).toBeUndefined();
  });

  it('adds a movement with neither set, so the pattern decides', () => {
    const added = addSlot(draft(), 1, press);
    const fresh = added.days[1]!.slots[1]!;

    expect(fresh.restSeconds).toBeUndefined();
    expect(fresh.incrementKg).toBeUndefined();
  });

  it('removes by index within the day', () => {
    const without = removeSlot(draft(), 0, 0);

    expect(without.days[0]!.slots.map((s) => s.exerciseName)).toEqual(['Overhead Press']);
  });
});

describe('dragging a movement to a new place in the day', () => {
  /** Three, because two cannot tell a move apart from a swap. */
  const three = (): Draft => ({
    name: 'Mein Plan',
    days: [{ code: 'PUSH', name: 'Push', slots: [slot(squat), slot(press), slot(row)] }],
  });

  const names = (d: Draft) => d.days[0]!.slots.map((s) => s.exerciseName);

  it('carries the row to the top and shifts the rest down', () => {
    expect(names(reorderSlot(three(), 0, 2, 0))).toEqual([
      'Seated Cable Row',
      'Back Squat',
      'Overhead Press',
    ]);
  });

  it('carries the row to the bottom and shifts the rest up', () => {
    expect(names(reorderSlot(three(), 0, 0, 2))).toEqual([
      'Overhead Press',
      'Seated Cable Row',
      'Back Squat',
    ]);
  });

  /**
   * The bug this guards against, and the reason the up/down buttons could not
   * simply be pointed at a longer distance. A swap of the ends would read
   * ['Row', 'Press', 'Squat'] — the middle movement left where it was, which
   * is not what a finger dragging past it described.
   */
  it('is a move and not a swap', () => {
    expect(names(reorderSlot(three(), 0, 0, 2))).not.toEqual([
      'Seated Cable Row',
      'Overhead Press',
      'Back Squat',
    ]);
  });

  it('leaves the day alone when the row was put back where it started', () => {
    const start = three();

    expect(reorderSlot(start, 0, 1, 1)).toEqual(start);
  });

  it('leaves the day alone rather than dropping a movement off either end', () => {
    const start = three();

    expect(reorderSlot(start, 0, 0, 3)).toEqual(start);
    expect(reorderSlot(start, 0, -1, 0)).toEqual(start);
    expect(reorderSlot(start, 1, 0, 1)).toEqual(start);
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

  it('leaves rest and increment out entirely when they were never set', () => {
    // Omitted, not null. The server reads "not given" as "let the movement
    // decide"; a null would have to be given a second meaning.
    const body = toSaveBody(draft());

    expect(body.days[0]!.slots[0]).not.toHaveProperty('restSeconds');
    expect(body.days[0]!.slots[0]).not.toHaveProperty('incrementKg');
  });

  it('sends them once the athlete has chosen', () => {
    const tuned = updateSlot(draft(), 0, 0, { restSeconds: 45, incrementKg: 5 });

    expect(toSaveBody(tuned).days[0]!.slots[0]).toMatchObject({
      restSeconds: 45,
      incrementKg: 5,
    });
  });
});

describe('the chips somebody picks from', () => {
  /**
   * These two guard a mismatch that has no other way of announcing itself.
   *
   * A slot loaded from the server always carries a concrete rest and a
   * concrete increment, and the sheet lights the chip that matches. If
   * `defaultsForPattern` produces a value no chip holds, the row renders with
   * nothing selected and reads as broken — on a screen nobody would think to
   * test, for a programme that is perfectly fine.
   *
   * The values below are `server/src/domain/program.ts`'s, copied rather than
   * imported because the app does not depend on the server's source.
   */
  it('covers every rest the server derives', () => {
    for (const derived of [180, 150, 60]) {
      expect(REST_SECONDS).toContain(derived);
    }
  });

  it('covers every increment the server derives or the catalogue seeds', () => {
    // 2.5 and 1.25 from defaultsForPattern; 5 from the hack squat and the
    // hip thrust in migration 015.
    for (const derived of [2.5, 1.25, 5]) {
      expect(INCREMENTS_KG).toContain(derived);
    }
  });
});
