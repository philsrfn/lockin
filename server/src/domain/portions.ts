/**
 * How much of a food was actually eaten.
 *
 * A food row is one of two things and the difference is the whole of this
 * module: either it *is* a portion — a tub of Skyr, a shake, the thing a
 * quick-add tile logs with one tap — or its numbers describe a weight, and
 * somebody has to say how much before there is anything to log.
 *
 * The second kind arrived with barcodes and was never given anywhere to say
 * so, which meant both readers of the table guessed, and both guessed 100g.
 * See migration 027.
 *
 * The refusal is the point. A missing portion is not a reason to assume one:
 * the number goes into the food log, and the food log is what remaining
 * protein, the deficit and the Sunday review are all computed from. A wrong
 * number there is worse than a question.
 */

export type Macros = {
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
};

/**
 * A portion nobody could eat. Not a validation rule so much as a typo filter:
 * 2500 g of peanut butter is a missing decimal point, and 0 g is a mis-tap.
 */
export const MAX_PORTION_G = 3000;

export type Basis = {
  /** null = the row is already one portion. 100 = the numbers are per 100g. */
  perGrams: number | null;
  /** What was eaten. Required, and only meaningful, when perGrams is set. */
  grams?: number | null;
};

/**
 * The macros to log, or null when the food is measured by weight and no
 * weight was given.
 *
 * Null is the honest answer rather than an exception because the caller has
 * to turn it into a question — a route into a 400, a screen into a keyboard.
 */
export function portionOf(macros: Macros, basis: Basis): Macros | null {
  // A portion. The grams, if somebody sent any, describe nothing here.
  if (basis.perGrams == null) return { ...macros };

  const grams = basis.grams;
  if (grams == null || !Number.isFinite(grams) || grams <= 0 || grams > MAX_PORTION_G) {
    return null;
  }

  const factor = grams / basis.perGrams;

  // Rounded per field at the end, not accumulated: these are integers in the
  // database and the alternative is fractions of a gram of fat.
  return {
    kcal: Math.round(macros.kcal * factor),
    proteinG: Math.round(macros.proteinG * factor),
    fatG: macros.fatG == null ? null : Math.round(macros.fatG * factor),
    carbsG: macros.carbsG == null ? null : Math.round(macros.carbsG * factor),
  };
}

/**
 * What the log line should read.
 *
 * The weight belongs in the description, not only in the arithmetic: a log
 * that says "Skyr" when it meant 250 g of it cannot be checked afterwards,
 * and checking afterwards is most of what a food log is for.
 */
export function describePortion(name: string, basis: Basis): string {
  if (basis.perGrams == null || basis.grams == null) return name;
  return `${name} (${basis.grams} g)`;
}

/**
 * What to offer when asking how much.
 *
 * Last time beats a round number. Somebody who ate 60 g of the same protein
 * bar on Tuesday is far likelier to eat 60 again than 100 — and 100 was never
 * chosen by anybody, it is just the number the label happens to be printed
 * against.
 */
export function suggestedGrams(lastGrams: number | null, perGrams: number | null): number | null {
  if (perGrams == null) return null;
  return lastGrams && lastGrams > 0 ? lastGrams : perGrams;
}
