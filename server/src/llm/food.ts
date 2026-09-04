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

export type FoodEstimate = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** low = they should really check this before saving. */
  confidence: 'low' | 'medium' | 'high';
  assumptions: string;
};

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

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The estimate came back malformed', true);
  }

  // Clamp rather than trust. A model that returns 40000 kcal should not be able
  // to put 40000 kcal in front of him as though it were considered.
  const clamp = (value: unknown, max: number) =>
    Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

  const confidence = parsed.confidence;

  return {
    name: String(parsed.name ?? described).slice(0, 120) || described.slice(0, 120),
    kcal: clamp(parsed.kcal, 5000),
    proteinG: clamp(parsed.proteinG, 500),
    fatG: clamp(parsed.fatG, 500),
    carbsG: clamp(parsed.carbsG, 1000),
    confidence:
      confidence === 'high' || confidence === 'medium' || confidence === 'low'
        ? confidence
        : 'low',
    assumptions: String(parsed.assumptions ?? '').slice(0, 300),
  };
}
