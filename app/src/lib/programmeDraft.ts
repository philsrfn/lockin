/**
 * Editing a programme, as pure functions over a draft.
 *
 * The editor is a form with six kinds of edit in it — add a day, rename one,
 * drop a movement, move one up, change a rep range, swap the exercise — and
 * every one of them is a place where an off-by-one quietly rewrites the wrong
 * day. So the edits live here where they can be tested, and the screen only
 * decides which one to call.
 *
 * The server's `domain/programDraft.ts` remains the authority on what may be
 * saved. `firstProblem` below decides whether a button is pressable, not
 * whether a programme is legal; when the two disagree the server wins and the
 * screen shows what it said.
 */
import type { Exercise, ProgramWithSlots } from '../api/types';

export type DraftSlot = {
  exerciseId: number;
  /** Carried for rendering only — the server resolves the id, not the name. */
  exerciseName: string;
  sets: number;
  repMin: number;
  repMax: number;
};

export type DraftDay = {
  /**
   * Present only for a day that already exists on the server.
   *
   * The code is what `sessions.template` stored, so it is history rather than
   * a label: it travels with the day through every rename, and a new day
   * deliberately has none — the server derives one and it never moves again.
   */
  code?: string;
  name: string;
  slots: DraftSlot[];
};

export type Draft = { name: string; days: DraftDay[] };

/**
 * The ranges people actually programme in, rather than two number fields.
 *
 * Two fields let somebody type 12–8 and find out from a server error; six
 * chips cannot express a range that is backwards, and they are one tap
 * instead of eight. 6–12 is the app's default everywhere else.
 */
export const REP_RANGES: readonly { min: number; max: number }[] = [
  { min: 3, max: 5 },
  { min: 5, max: 8 },
  { min: 6, max: 12 },
  { min: 8, max: 12 },
  { min: 10, max: 15 },
  { min: 12, max: 20 },
];

export const DEFAULT_RANGE = { min: 6, max: 12 };
export const DEFAULT_SETS = 3;
export const MAX_DAYS = 7;
export const MAX_SLOTS_PER_DAY = 12;
export const MAX_SETS = 10;

export function draftFrom(program: ProgramWithSlots): Draft {
  return {
    name: program.name,
    days: program.days.map((day) => ({
      code: day.code,
      name: day.name,
      slots: day.slots.map((slot) => ({
        exerciseId: slot.exerciseId,
        exerciseName: slot.exerciseName,
        sets: slot.sets,
        repMin: slot.range.min,
        repMax: slot.range.max,
      })),
    })),
  };
}

/** The shape `PUT /programs/:id` takes. Names are dropped; ids are the truth. */
export function toSaveBody(draft: Draft) {
  return {
    name: draft.name.trim(),
    days: draft.days.map((day) => ({
      ...(day.code ? { code: day.code } : {}),
      name: day.name.trim(),
      slots: day.slots.map((slot) => ({
        exerciseId: slot.exerciseId,
        sets: slot.sets,
        repMin: slot.repMin,
        repMax: slot.repMax,
      })),
    })),
  };
}

const replaceDay = (draft: Draft, index: number, day: DraftDay): Draft => ({
  ...draft,
  days: draft.days.map((existing, at) => (at === index ? day : existing)),
});

export const rename = (draft: Draft, name: string): Draft => ({ ...draft, name });

export function addDay(draft: Draft, name: string): Draft {
  if (draft.days.length >= MAX_DAYS) return draft;
  return { ...draft, days: [...draft.days, { name, slots: [] }] };
}

export function removeDay(draft: Draft, index: number): Draft {
  return { ...draft, days: draft.days.filter((_, at) => at !== index) };
}

export function renameDay(draft: Draft, index: number, name: string): Draft {
  const day = draft.days[index];
  if (!day) return draft;
  // The code is untouched on purpose: renaming Pull to Zug is a label change
  // and must not rewrite what happened in March.
  return replaceDay(draft, index, { ...day, name });
}

export function addSlot(draft: Draft, dayIndex: number, exercise: Exercise): Draft {
  const day = draft.days[dayIndex];
  if (!day || day.slots.length >= MAX_SLOTS_PER_DAY) return draft;
  return replaceDay(draft, dayIndex, {
    ...day,
    slots: [
      ...day.slots,
      {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: DEFAULT_SETS,
        repMin: DEFAULT_RANGE.min,
        repMax: DEFAULT_RANGE.max,
      },
    ],
  });
}

/** Swapping the movement, keeping the sets and reps that were set for it. */
export function replaceSlot(
  draft: Draft,
  dayIndex: number,
  slotIndex: number,
  exercise: Exercise,
): Draft {
  const day = draft.days[dayIndex];
  if (!day || !day.slots[slotIndex]) return draft;
  return replaceDay(draft, dayIndex, {
    ...day,
    slots: day.slots.map((slot, at) =>
      at === slotIndex
        ? { ...slot, exerciseId: exercise.id, exerciseName: exercise.name }
        : slot,
    ),
  });
}

export function updateSlot(
  draft: Draft,
  dayIndex: number,
  slotIndex: number,
  patch: Partial<Pick<DraftSlot, 'sets' | 'repMin' | 'repMax'>>,
): Draft {
  const day = draft.days[dayIndex];
  if (!day || !day.slots[slotIndex]) return draft;
  return replaceDay(draft, dayIndex, {
    ...day,
    slots: day.slots.map((slot, at) => (at === slotIndex ? { ...slot, ...patch } : slot)),
  });
}

export function removeSlot(draft: Draft, dayIndex: number, slotIndex: number): Draft {
  const day = draft.days[dayIndex];
  if (!day) return draft;
  return replaceDay(draft, dayIndex, {
    ...day,
    slots: day.slots.filter((_, at) => at !== slotIndex),
  });
}

/** Order is the order they are performed, so it has to be changeable. */
export function moveSlot(
  draft: Draft,
  dayIndex: number,
  slotIndex: number,
  direction: -1 | 1,
): Draft {
  const day = draft.days[dayIndex];
  const target = slotIndex + direction;
  if (!day || !day.slots[slotIndex] || !day.slots[target]) return draft;

  const slots = [...day.slots];
  [slots[slotIndex], slots[target]] = [slots[target]!, slots[slotIndex]!];
  return replaceDay(draft, dayIndex, { ...day, slots });
}

export type DraftProblem =
  | 'name_missing'
  | 'no_days'
  | 'day_name_missing'
  | 'day_empty'
  | 'duplicate_exercise';

/**
 * The first thing standing between this draft and a save.
 *
 * One at a time rather than all of them: this is under a button, and a list
 * of five complaints under a button reads as a rejection rather than as the
 * next thing to do. The server reports the whole set to the trainer, which is
 * the caller that can act on all of them at once.
 */
export function firstProblem(draft: Draft): DraftProblem | null {
  if (!draft.name.trim()) return 'name_missing';
  if (draft.days.length === 0) return 'no_days';

  for (const day of draft.days) {
    if (!day.name.trim()) return 'day_name_missing';
    if (day.slots.length === 0) return 'day_empty';

    // The same movement twice in one day is nearly always a mis-tap, and the
    // progression would read the two slots as one history anyway.
    const ids = day.slots.map((slot) => slot.exerciseId);
    if (new Set(ids).size !== ids.length) return 'duplicate_exercise';
  }

  return null;
}

/** "3 × 6–12", the way it is written on a programme card. */
export const describeSlot = (slot: DraftSlot): string =>
  `${slot.sets} × ${slot.repMin}–${slot.repMax}`;
