/**
 * Which logged meals are worth keeping as foods.
 *
 * §4 says the library "grows by use", and §11 builds the Food screen on that:
 * quick-add tiles for actual staples, then recents, then the athlete's own
 * library. Only one of the four ways to log a meal ever grew it. A barcode
 * scan saved a food; describing a meal in words did not, and neither did
 * telling the trainer about it in chat.
 *
 * So for anybody who logs by talking — which, measured across this server, is
 * most of the logging that happens — the tiles stayed empty forever, the
 * library stayed empty forever, and the structured screen that was supposed
 * to absorb the repeating 95% had nothing in it to tap. Which sends them back
 * to chat. The premise was not wrong; it was wired to one path out of four.
 *
 * The rule is the wording of §4 taken literally: a food enters the library
 * the *second* time it is eaten. A restaurant meal nobody repeats is a meal;
 * the thing eaten on Tuesday and again on Thursday is a staple, and it is the
 * one worth a tile.
 */

export type MealForLibrary = {
  description: string;
  kcal?: number | null;
  proteinG?: number | null;
  /** Already a library entry — this meal came from one. */
  foodId?: number | null;
};

/**
 * How two descriptions of the same thing are recognised as the same thing.
 *
 * Case and spacing only. Nothing cleverer: "Skyr mit Beeren" and "Skyr, 500g,
 * mit Beeren" are different entries, and that is the honest answer — they
 * have different macros, and guessing they are one thing would put a number
 * in the library that nobody ate.
 */
export const libraryKey = (description: string): string =>
  description.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The key this meal would be remembered under, or null if it should not be.
 *
 * Macros are required because a library entry without them cannot be tapped
 * to log anything — it would be a name that does nothing.
 */
export function libraryKeyFor(meal: MealForLibrary): string | null {
  if (meal.foodId != null) return null;
  if (meal.kcal == null || meal.proteinG == null) return null;

  const key = libraryKey(meal.description);
  return key.length > 0 ? key : null;
}

/**
 * Whether this is the repeat that earns a place.
 *
 * `timesEatenBefore` counts the same description already in the log. One is
 * enough: this is the second time.
 */
export const earnsItsPlace = (timesEatenBefore: number): boolean => timesEatenBefore >= 1;
