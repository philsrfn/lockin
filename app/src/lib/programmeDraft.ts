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
  /**
   * Undefined means the movement's pattern decides, which is what a slot that
   * has never been saved wants. A slot loaded from the server always has both,
   * because the columns are not null — so in practice these are only absent
   * for a movement added or swapped in this editing session.
   */
  restSeconds?: number;
  incrementKg?: number;
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

/**
 * Rest, as chips for the same reason the rep ranges are chips.
 *
 * Every value `defaultsForPattern` produces on the server is in this list —
 * 60, 150 and 180 — because a slot loaded from the server that matched no
 * chip would render with nothing selected and read as broken.
 */
export const REST_SECONDS: readonly number[] = [60, 90, 120, 150, 180, 240];

/**
 * The jumps that exist on a rack.
 *
 * This is the field the whole change is for: the pattern default assumes 2.5
 * kg plates and 1.25 kg for isolation, and somebody whose gym has 0.5 kg
 * micro-plates — or whose machine stack moves in fives — was stuck with an
 * assumption made about a different room. 1.25 and 2.5 are the defaults, 5 is
 * what the catalogue already gives the hack squat.
 */
export const INCREMENTS_KG: readonly number[] = [0.5, 1, 1.25, 2.5, 5];

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
        restSeconds: slot.restSeconds,
        incrementKg: slot.incrementKg,
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
        // Omitted rather than sent as null when absent: the server reads
        // "not given" as "let the movement decide", and a null would have to
        // mean something else again.
        ...(slot.restSeconds !== undefined ? { restSeconds: slot.restSeconds } : {}),
        ...(slot.incrementKg !== undefined ? { incrementKg: slot.incrementKg } : {}),
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
        ? {
            ...slot,
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            // Rest and increment do not travel with the swap, unlike sets and
            // reps. Three sets of eight means the same thing on a cable fly
            // as on a squat; a 5 kg jump does not, and carrying one over from
            // the movement that used to be here is how a lateral raise ends
            // up prescribed in fives.
            restSeconds: undefined,
            incrementKg: undefined,
          }
        : slot,
    ),
  });
}

export function updateSlot(
  draft: Draft,
  dayIndex: number,
  slotIndex: number,
  patch: Partial<Pick<DraftSlot, 'sets' | 'repMin' | 'repMax' | 'restSeconds' | 'incrementKg'>>,
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

/**
 * Order is the order they are performed, so it has to be changeable — and
 * since the row is dragged, it has to be changeable across any distance.
 *
 * Not a swap. Dragging the fifth movement to the top means the four above it
 * each shift down one; swapping first and fifth would leave the first
 * movement stranded in the middle, which is not what anybody's hand just
 * described. This replaced a one-step `moveSlot` behind up/down buttons,
 * which said the same thing one neighbour at a time.
 */
export function reorderSlot(draft: Draft, dayIndex: number, from: number, to: number): Draft {
  const day = draft.days[dayIndex];
  if (!day || !day.slots[from] || !day.slots[to] || from === to) return draft;

  const slots = [...day.slots];
  const [moved] = slots.splice(from, 1);
  slots.splice(to, 0, moved!);
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
