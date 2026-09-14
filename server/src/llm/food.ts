/**
 * Estimating macros from a plain-text description: "chicken and rice with
 * broccoli", "zwei Scheiben Vollkornbrot mit Käse".
 *
 * On §1 — "the LLM never computes a number that matters". This does not break
 * that rule, and the distinction is worth being precise about:
 *
 *   Arithmetic stays in code. Summing the day, remaining protein, the fat
 *   floor, the weight trend, progressive overload — none of that goes near a
 *   model, and none of it does here either.
 *
 *   This is estimation, not computation. There is no deterministic answer to
 *   "how much protein was in that plate", and §11 explicitly rules out
 *   integrating a nutrition database. The alternative is not a better number,
 *   it is no number at all.
 *
 * The estimate is never written straight to the log: it comes back as a
 * candidate the app shows them to confirm or correct, the same principle §9
 * applies to the fridge photo. A guess they have agreed with is data. A guess
 * written silently is corruption.
 */
import type { Ctx } from '../db';
import { LlmError } from './provider';
import { generateFor } from './metered';
import { type FoodEstimate, clampEstimate } from '../domain/foodEstimate';

export type { FoodEstimate } from '../domain/foodEstimate';

const SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'A short label for the log, in the language they wrote in. Under 60 characters.',
    },
    kcal: { type: 'integer', description: 'Total calories for the whole portion described' },
    proteinG: { type: 'integer', description: 'Total protein in grams' },
    fatG: { type: 'integer', description: 'Total fat in grams' },
    carbsG: { type: 'integer', description: 'Total carbohydrate in grams' },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description:
        'high when they gave weights or a standard packaged item; low when the portion is genuinely unclear',
    },
    assumptions: {
      type: 'string',
      description:
        'One short sentence naming the portion you assumed, so they can correct it. ' +
        'Empty if they were specific.',
    },
  },
  required: ['name', 'kcal', 'proteinG', 'fatG', 'carbsG', 'confidence', 'assumptions'],
};

/**
 * Deliberately says nothing about whose food this is.
 *
 * It used to open with one athlete's height and calorie target, which was
 * true when there was one athlete and became a bias the moment there were
 * more: every estimate was anchored to a 191 cm man's portions regardless of
 * who was logging. Body-specific anchoring belongs in the athlete's own
 * context, not in a constant — and the honest default for an unknown person
 * is a portion, not a person.
 */
const INSTRUCTION = `You estimate the macros of food a lifter describes in one line.

They log on their phone between other things, and write in English or German,
often both in one line.

Estimate the WHOLE portion they described, not per 100g. If they gave a weight,
use it. If they did not, assume the portion an adult training hard actually
eats — not a packet's serving suggestion — and say what you assumed in one
short sentence so they can correct it.

Be honest about confidence. "200g chicken breast" is high. "some pasta with
sauce" is low, and saying so is more useful than a confident wrong number.

Round to whole grams and whole calories. Do not add commentary, do not moralise
about the food, and never refuse to estimate something.`;

/**
 * A photo of a plate.
 *
 * The other way in. Somebody eating out, or cooking something they cannot
 * describe in a line, points a camera at it — which is what "scan my food"
 * means to everybody who has used another app, and what the barcode scanner
 * here has never been able to do: a barcode is a packet, and most meals are
 * not packets.
 *
 * A photo answers *what* well and *how much* badly. There is no scale in a
 * picture — the same plate of rice is 150 g or 400 g depending on how far away
 * the camera was — so the instruction leans on what is actually visible for
 * scale, and the result is expected to be less confident than a typed weight.
 * That is the honest outcome, and `confidence: 'low'` is the app's way of
 * saying "check this" rather than a failure.
 *
 * `note` is how somebody supplies what the lens cannot: "mit 200 g Reis". It
 * is optional and it is the difference between a guess and an estimate.
 *
 * The photo is never stored. It goes to the model and is gone — §9's rule for
 * the fridge, for the same reason: the app has no use for the picture once it
 * has the answer, and a photo of somebody's dinner table is not a thing to
 * keep because it was easy to.
 */
const PHOTO_INSTRUCTION = `You estimate the macros of a meal from a photograph of it.

Name the dish the way the person eating it would, in the language of anything
written in the picture, otherwise German.

WHAT A PHOTO CAN AND CANNOT TELL YOU

It tells you what the food is. It does not tell you how much, and that is where
the error lives: the same plate of rice is 150g or 400g depending on where the
camera was. Use what is actually in frame for scale — the plate against a fork,
a hand, a standard tin — and say in one sentence what portion you settled on so
it can be corrected.

Estimate the WHOLE thing shown. If half of it is plainly somebody else's, say
so in the assumption rather than halving silently.

Count what you can see, including the oil a fried thing was cooked in, which is
the single most underestimated item in a photograph of a meal.

CONFIDENCE

Lower than you would be from a written weight, and say so. A packaged item with
a readable label is high. A plate of home-cooked food at an angle is medium at
best. Something in a bowl you cannot see the bottom of is low. An honest low
beats a confident wrong number, because the person can correct a number they
were told to check.

Do not describe what is not there. Do not moralise about the food. Never refuse
to estimate.`;

export async function estimateFoodFromPhoto(
  ctx: Ctx,
  imageBase64: string,
  mimeType: string,
  note?: string,
): Promise<FoodEstimate> {
  const said = (note ?? '').trim().slice(0, 200);

  const output = await generateFor(ctx, {
    purpose: 'food_photo',
    systemInstruction: PHOTO_INSTRUCTION,
    history: [
      {
        role: 'user',
        text: said ? `What is on this plate? They added: ${said}` : 'What is on this plate?',
        images: [{ data: imageBase64, mimeType }],
      },
    ],
    responseSchema: SCHEMA,
    model: 'fast',
    maxOutputTokens: 2000,
    temperature: 0.2,
  });

  return toEstimate(output.text, said || 'Foto');
}

export async function estimateFood(ctx: Ctx, text: string): Promise<FoodEstimate> {
  const described = text.trim();
  if (!described) throw new LlmError('Nothing to estimate', false);
  if (described.length > 400) throw new LlmError('That description is too long', false);

  const output = await generateFor(ctx, {
      purpose: 'food_estimate',
    systemInstruction: INSTRUCTION,
    history: [{ role: 'user', text: described }],
    responseSchema: SCHEMA,
    model: 'fast',
    maxOutputTokens: 2000,
    temperature: 0.2,
  });

  return toEstimate(output.text, described);
}

/**
 * Model output to an estimate, for both ways in.
 *
 * One place, because the clamping is the part that matters and two copies of
 * it is one copy that will drift. The clamping itself lives in
 * `domain/foodEstimate.ts` — it is the guard rather than the guess, and §1
 * puts guards in code with tests around them.
 */
function toEstimate(text: string, fallbackName: string): FoodEstimate {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The estimate came back malformed', true);
  }

  return clampEstimate(parsed, fallbackName);
}
