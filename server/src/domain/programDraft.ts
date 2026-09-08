/**
 * Turning what somebody typed into a programme the rest of the app can use.
 *
 * §14 said not to build a generic programme builder, and for one athlete with
 * one rotation that was right. It stopped being right the moment other people
 * started using this: a preset is the opposite of hyperpersonal, and somebody
 * whose gym has no hack squat is not served by three programmes chosen for
 * somebody else's Hansefit.
 *
 * What has to survive that change is the thing progression is computed from.
 *
 * ---
 *
 * **Day codes are history, not labels.** `sessions.template` stores the code,
 * and migration 015 says plainly that changing one orphans every session
 * logged against it. So codes are derived once, from the name, and then never
 * move again. The name stays editable — renaming "Pull" to "Zug" is a label
 * change and must not rewrite what happened in March.
 *
 * That is why this module exists rather than a zod schema: the rules are
 * about what a programme *means* over time, not about the shape of a request.
 */

/** `sessions.template` is text; short codes keep the logger's header honest. */
export const MAX_CODE_LENGTH = 12;
export const MAX_DAYS = 7;
export const MAX_SLOTS_PER_DAY = 12;

export type DraftSlot = {
  exerciseId: number;
  sets: number;
  repMin: number;
  repMax: number;
};

export type DraftDay = {
  /** Present when this day already exists: its code is then untouchable. */
  code?: string;
  name: string;
  slots: DraftSlot[];
};

export type Draft = {
  name: string;
  days: DraftDay[];
};

/**
 * A code from a name: letters and digits, upper case, first word or two.
 *
 * "Pull" becomes PULL, "Oberkörper A" becomes OBERKOR… truncated, and an
 * empty or unusable name falls back to a number so a day always has one.
 * Collisions get a numeric suffix, because two days sharing a code would make
 * their histories indistinguishable.
 */
export function dayCodeFrom(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '')
      .toUpperCase()
      .slice(0, MAX_CODE_LENGTH) || 'DAY';

  if (!taken.includes(base)) return base;

  for (let n = 2; n < 100; n += 1) {
    const suffixed = `${base.slice(0, MAX_CODE_LENGTH - String(n).length)}${n}`;
    if (!taken.includes(suffixed)) return suffixed;
  }
  // Ninety-nine days called the same thing is not a programme.
  throw new Error('Could not find a free day code');
}

export type Problem =
  | 'name_missing'
  | 'no_days'
  | 'too_many_days'
  | 'day_name_missing'
  | 'day_empty'
  | 'too_many_slots'
  | 'duplicate_exercise'
  | 'bad_sets'
  | 'bad_reps';

/**
 * Everything wrong with a draft, rather than the first thing.
 *
 * A screen that reports one problem at a time makes somebody fix six things
 * in six round trips.
 */
export function validateDraft(draft: Draft): Problem[] {
  const problems = new Set<Problem>();

  if (!draft.name.trim()) problems.add('name_missing');
  if (draft.days.length === 0) problems.add('no_days');
  if (draft.days.length > MAX_DAYS) problems.add('too_many_days');

  for (const day of draft.days) {
    if (!day.name.trim()) problems.add('day_name_missing');
    if (day.slots.length === 0) problems.add('day_empty');
    if (day.slots.length > MAX_SLOTS_PER_DAY) problems.add('too_many_slots');

    // The same movement twice in one day is almost always a mis-tap, and the
    // progression would read the two slots as one history anyway.
    const ids = day.slots.map((slot) => slot.exerciseId);
    if (new Set(ids).size !== ids.length) problems.add('duplicate_exercise');

    for (const slot of day.slots) {
      if (!Number.isInteger(slot.sets) || slot.sets < 1 || slot.sets > 10) {
        problems.add('bad_sets');
      }
      const repsSane =
        Number.isInteger(slot.repMin) &&
        Number.isInteger(slot.repMax) &&
        slot.repMin >= 1 &&
        slot.repMax >= slot.repMin &&
        slot.repMax <= 50;
      if (!repsSane) problems.add('bad_reps');
    }
  }

  return [...problems];
}

/**
 * Codes for a saved draft: kept where a day already had one, derived where it
 * did not, and unique across the programme either way.
 */
export function assignCodes(days: DraftDay[]): { code: string; name: string; slots: DraftSlot[] }[] {
  const taken = days.map((day) => day.code).filter((code): code is string => !!code);
  const out: { code: string; name: string; slots: DraftSlot[] }[] = [];

  for (const day of days) {
    const code = day.code ?? dayCodeFrom(day.name, taken);
    if (!day.code) taken.push(code);
    out.push({ code, name: day.name.trim(), slots: day.slots });
  }

  return out;
}
