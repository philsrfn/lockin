/**
 * Turning what a model said about food into something safe to show.
 *
 * §1 keeps numbers that matter out of the model, and a macro estimate is the
 * one place that rule bends — there is no deterministic answer to "how much
 * protein was on that plate", and `llm/food.ts` explains why the alternative
 * is no number rather than a better one.
 *
 * This is the part that makes the bend safe. Everything the model returns
 * passes through here before anybody sees it, so a plate cannot come back at
 * 40 000 kcal and be shown as though it were considered, a missing field
 * cannot become `NaN` in somebody's daily total, and a confidence the model
 * invented a new word for reads as `low` rather than as nothing.
 *
 * Pure, and tested, because it is the guard rather than the guess.
 */

export type Confidence = 'low' | 'medium' | 'high';

export type FoodEstimate = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** low = they should really check this before saving. */
  confidence: Confidence;
  assumptions: string;
};

/**
 * Ceilings, not expectations.
 *
 * A single logged item above any of these is somebody's whole day or a model
 * that lost its footing, and in both cases the honest thing is a number they
 * will notice rather than one that quietly ruins a week of totals.
 */
const MAX = { kcal: 5000, proteinG: 500, fatG: 500, carbsG: 1000 } as const;

const clamp = (value: unknown, max: number): number =>
  Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

const CONFIDENCES: Confidence[] = ['low', 'medium', 'high'];

/**
 * `fallbackName` is what the log is called when the model returns nothing
 * usable — the line somebody typed, or the word for a photograph.
 */
export function clampEstimate(parsed: Record<string, unknown>, fallbackName: string): FoodEstimate {
  const name = String(parsed.name ?? '').trim().slice(0, 120);
  const confidence = parsed.confidence;

  return {
    name: name || fallbackName.slice(0, 120),
    kcal: clamp(parsed.kcal, MAX.kcal),
    proteinG: clamp(parsed.proteinG, MAX.proteinG),
    fatG: clamp(parsed.fatG, MAX.fatG),
    carbsG: clamp(parsed.carbsG, MAX.carbsG),
    // Anything unrecognised reads as low, which is the app telling somebody to
    // check it. Defaulting the other way would hide exactly the estimates
    // worth looking at.
    confidence: CONFIDENCES.includes(confidence as Confidence)
      ? (confidence as Confidence)
      : 'low',
    assumptions: String(parsed.assumptions ?? '').slice(0, 300),
  };
}
