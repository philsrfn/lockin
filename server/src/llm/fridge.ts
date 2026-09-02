/**
 * Fridge photo → inventory → meal plan (§9).
 *
 * The pipeline is deliberately interrupted in the middle. Step 3 of §9:
 * "User confirms/edits the list. Never generate a plan off an unconfirmed
 * vision pass — mis-detected ingredients produce plans he can't actually
 * cook." So vision returns candidates and stops; the plan is a separate call
 * that runs only against a list he has confirmed.
 *
 * The photo is never stored. It is passed to the model and dropped.
 */
import { LlmError } from './provider';
import { geminiProvider } from './gemini';
import { type Queryable, pool } from '../db';
import { remaining } from '../domain/macros';
import { validateMealPlan } from '../rules/validator';
import { listRules } from '../services/rules';
import { activeContext } from '../services/contexts';
import { macrosToday, mealsToday } from '../services/meals';
import { getProfile, macroTargets } from '../services/profile';

export type FridgeItem = {
  name: string;
  estimatedQty: string;
  confidence: 'low' | 'medium' | 'high';
};

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The ingredient, in German if the packaging is German' },
          estimatedQty: { type: 'string', description: 'Rough amount, e.g. "half a pack", "~400g", "3"' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['name', 'estimatedQty', 'confidence'],
      },
    },
  },
  required: ['items'],
};

const VISION_INSTRUCTION = `List the food you can actually see in this fridge or cupboard photo.

Name things as a German shopper would. Give a rough quantity — he will correct
it. Mark confidence honestly: a clearly readable Skyr tub is high, a vague
container at the back is low.

Only list what you can see. Do not infer that a fridge "probably" has eggs. A
mis-detected ingredient becomes a meal he cannot cook, which is worse than a
short list.`;

export async function readFridgePhoto(
  imageBase64: string,
  mimeType: string,
): Promise<FridgeItem[]> {
  const output = await geminiProvider.generate({
    systemInstruction: VISION_INSTRUCTION,
    history: [
      {
        role: 'user',
        text: 'What food is in this photo?',
        images: [{ data: imageBase64, mimeType }],
      },
    ],
    responseSchema: VISION_SCHEMA,
    model: 'fast',
    maxOutputTokens: 4000,
    temperature: 0.1,
  });

  let parsed: { items?: unknown[] };
  try {
    parsed = JSON.parse(output.text) as { items?: unknown[] };
  } catch {
    throw new LlmError('Could not read that photo', true);
  }

  return (parsed.items ?? [])
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      const confidence = item.confidence;
      const item_: FridgeItem = {
        name: String(item.name ?? '').slice(0, 80),
        estimatedQty: String(item.estimatedQty ?? '').slice(0, 40),
        confidence:
          confidence === 'high' || confidence === 'medium' || confidence === 'low'
            ? confidence
            : 'low',
      };
      return item_;
    })
    .filter((item) => item.name.length > 0)
    .slice(0, 40);
}

export type MealIdea = {
  name: string;
  slot: string;
  usesFromFridge: string[];
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  method: string;
};

export type MealPlan = {
  meals: MealIdea[];
  note: string;
  /** Set when the first attempt broke a rule and had to be regenerated. */
  reprompted: boolean;
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          usesFromFridge: { type: 'array', items: { type: 'string' } },
          kcal: { type: 'integer' },
          proteinG: { type: 'integer' },
          fatG: { type: 'integer' },
          carbsG: { type: 'integer' },
          method: { type: 'string', description: 'Two sentences at most. He can cook.' },
        },
        required: ['name', 'slot', 'usesFromFridge', 'kcal', 'proteinG', 'fatG', 'carbsG', 'method'],
      },
    },
    note: { type: 'string', description: 'One line. What this leaves him short of, if anything.' },
  },
  required: ['meals', 'note'],
};

/**
 * §9 step 5: plans against **remaining** macros for today, not the daily total.
 * Planning against the full target at 8pm is how you get told to eat 2300 kcal
 * on top of what you already ate.
 */
export async function generateMealPlan(
  items: FridgeItem[],
  db: Queryable = pool,
): Promise<MealPlan> {
  if (items.length === 0) throw new LlmError('Nothing in the list to cook with', false);

  const [profile, consumed, context, rules, logged] = await Promise.all([
    getProfile(db),
    macrosToday(db),
    activeContext(db),
    listRules(db),
    mealsToday(db),
  ]);

  const left = remaining(macroTargets(profile), consumed);
  const active = rules.filter(
    (rule) => rule.active && (!rule.scope || rule.scope === context?.name),
  );

  const eatenSlots = [...new Set(logged.map((meal) => meal.slot))];

  const brief = [
    `In the fridge: ${items.map((item) => `${item.name} (${item.estimatedQty})`).join(', ')}.`,
    `He is in ${context?.name ?? 'an unknown city'}.`,
    logged.length
      ? `Already eaten today: ${logged.map((meal) => `${meal.slot} — ${meal.description} (${meal.proteinG ?? 0}g protein)`).join('; ')}.`
      : 'He has not logged anything yet today.',
    eatenSlots.length
      ? `Do NOT plan another ${eatenSlots.join(' or ')} — those are done. Plan only the slots he has left.`
      : '',
    `Remaining today: ${left.kcal} kcal, ${left.proteinG}g protein, and he still needs ${left.fatToFloorG}g fat to clear his floor.`,
    'Plan only what is left of today, not a whole day.',
    'Rules you must respect:',
    ...active.map((rule) => `- [${rule.tier}] ${rule.text}`),
  ]
    .filter(Boolean)
    .join('\n');

  const instruction = `You plan food for Phil from what is actually in his fridge.

Cover what is LEFT of today, not a fresh day. Protein is the number that
matters; calories are a ceiling, not a target to fill.

Use what is in the list. You may assume salt, pepper, oil and basic spices.
Anything else, do not use it — he cannot cook with ingredients he does not
have.

Keep the method to two sentences. He can cook, he does not need a recipe.
Never moralise about food.`;

  const ask = async (extra?: string): Promise<MealPlan> => {
    const output = await geminiProvider.generate({
      systemInstruction: instruction,
      history: [{ role: 'user', text: extra ? `${brief}\n\n${extra}` : brief }],
      responseSchema: PLAN_SCHEMA,
      model: 'fast',
      maxOutputTokens: 4000,
      temperature: 0.6,
    });

    try {
      const parsed = JSON.parse(output.text) as { meals?: MealIdea[]; note?: string };
      return { meals: parsed.meals ?? [], note: String(parsed.note ?? ''), reprompted: !!extra };
    } catch {
      throw new LlmError('The meal plan came back malformed', true);
    }
  };

  let plan = await ask();

  // §5: validate, re-prompt once naming the violation, then fall back rather
  // than surfacing something that breaks his rules.
  /**
   * The validator checks a whole day, but this plan only covers what is left of
   * one. Validating the plan alone made it re-add a breakfast he had already
   * eaten, just to satisfy the Skyr rule — a plan that would have him eat it
   * twice. So the check runs against the logged meals plus the planned ones.
   */
  const asDay = (current: MealPlan) => ({
    meals: [
      ...logged.map((meal) => ({
        slot: meal.slot,
        description: meal.description ?? '',
        kcal: meal.kcal ?? 0,
        proteinG: meal.proteinG ?? 0,
      })),
      ...current.meals.map((meal) => ({
        slot: meal.slot as 'breakfast' | 'lunch' | 'dinner' | 'snack',
        description: meal.name,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
      })),
    ],
  });

  const contextName = context?.name ?? null;
  let violations = validateMealPlan(asDay(plan), rules, contextName);

  if (violations.length > 0) {
    plan = await ask(
      `Your last answer broke a rule: ${violations.map((v) => v.message).join(' ')} Fix it and answer again.`,
    );

    violations = validateMealPlan(asDay(plan), rules, contextName);
    if (violations.length > 0) {
      // Say so rather than quietly presenting a plan that breaks his rules.
      const detail = violations.map((v) => v.message).join(' ');
      plan.note =
        `${plan.note} (This still breaks a rule: ${detail} Treat it as a suggestion, not a plan.)`.trim();
      console.warn('meal plan failed validation twice:', detail);
    }
  }

  return plan;
}
