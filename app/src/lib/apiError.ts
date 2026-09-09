/**
 * What to show somebody when a request fails.
 *
 * Every screen used to write the same line: `caught instanceof ApiError ?
 * caught.message : t('somethingLocal')`. That prints the server's own prose,
 * which is English — so a German athlete scanning a tub of quark that
 * OpenFoodFacts has never heard of got "No product with that barcode" on an
 * otherwise German screen. It is the first thing anybody new does with the
 * scanner, so it is a first impression as much as an error.
 *
 * The server tags the errors a person can actually walk into with a stable
 * code (see `server/src/errors.ts`). Those get real words here, in both
 * languages. Everything else keeps falling back to what the screen would have
 * said anyway, because an untranslated sentence about a bug is still better
 * than a blank.
 */
import { ApiError } from '../api/error';
import { type PhraseKey, t } from './locale';

/**
 * Codes to phrases. A code with no entry is not an error — it is one the app
 * has no better words for yet, and it falls through to the caller's fallback.
 */
const CODES: Record<string, PhraseKey> = {
  barcode_malformed: 'errBarcodeMalformed',
  barcode_unknown: 'errBarcodeUnknown',
  barcode_no_nutrition: 'errBarcodeNoNutrition',
  food_db_unreachable: 'errFoodDbUnreachable',
  food_db_down: 'errFoodDbDown',
  grams_required: 'errGramsRequired',
  programme_in_use: 'errProgrammeInUse',
  programme_unusable: 'programmeNeedsWork',
  fridge_empty: 'errFridgeEmpty',
  // Every schema rejection. Vague on purpose — these are reachable when the
  // app sends something it should not have, and "Invalid request" was no more
  // specific while also being in the wrong language.
  invalid_request: 'errInvalidRequest',
  // Not a failure the athlete caused, and the one they are likeliest to see:
  // a phone that cannot reach the server at all.
  offline: 'errOffline',
};

/**
 * `fallback` is what this screen would have said on its own — "could not load
 * your rules" — and it is used whenever the server did not say anything
 * better in a language we have.
 */
export function messageFor(caught: unknown, fallback: PhraseKey): string {
  if (!(caught instanceof ApiError)) return t(fallback);

  const phrase = caught.code ? CODES[caught.code] : undefined;
  if (phrase) return t(phrase);

  // A dropped connection carries no code and no useful message — `status` is
  // 0 and the text is whatever fetch threw.
  if (caught.status === 0) return t('errOffline');

  // An untranslated server message is still more specific than the fallback,
  // and these are the ones that only appear when something is actually wrong.
  return caught.message || t(fallback);
}
