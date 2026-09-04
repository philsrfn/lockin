/**
 * §9 step 4 — the confirmed list, and the tool that plans from it.
 *
 * The plan itself is a model call and is not exercised here. What is worth
 * testing is everything around it: that confirmation is durable, that it stays
 * inside one athlete, and above all that the trainer refuses rather than
 * inventing a fridge. That last one is the whole point of §9.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import { runTool } from '../../llm/handlers';
import { TOOLS } from '../../llm/tools';
import { MAX_INVENTORY_AGE_HOURS } from '../../domain/fridge';
import { activateContext, listContexts } from '../contexts';
import { latestInventory, normaliseItems, saveInventory } from '../fridge';
import { anotherAthlete, phil, resetData } from '../../test/helpers';

const item = (name: string, estimatedQty = '1 pack') =>
  ({ name, estimatedQty, confidence: 'high' }) as const;

/** Backdates a stored list. Only a clock can do this to a real athlete. */
async function backdate(id: number, hours: number): Promise<void> {
  await pool.query(
    `update fridge_inventory set captured_at = now() - ($2 || ' hours')::interval where id = $1`,
    [id, String(hours)],
  );
}

beforeEach(resetData);

describe('confirming a fridge', () => {
  it('stores the list and hands it back as the latest one', async () => {
    const saved = await saveInventory(phil, [item('Skyr', '500g'), item('Hähnchenbrust', '~400g')]);

    expect(saved.items.map((i) => i.name)).toEqual(['Skyr', 'Hähnchenbrust']);
    expect((await latestInventory(phil))?.id).toBe(saved.id);
  });

  it('records where they were when they photographed it', async () => {
    const places = await listContexts(phil);
    await activateContext(phil, places.find((place) => place.name === 'City C')!.id);

    expect((await saveInventory(phil, [item('Eier')])).contextName).toBe('City C');
  });

  it('refuses an empty list rather than storing a fridge with nothing in it', async () => {
    await expect(saveInventory(phil, [])).rejects.toMatchObject({ statusCode: 400 });
    await expect(saveInventory(phil, [item('   ')])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps the most recent, not the first', async () => {
    const first = await saveInventory(phil, [item('Old milk')]);
    await backdate(first.id, 30);
    await saveInventory(phil, [item('Fresh milk')]);

    expect((await latestInventory(phil))?.items.map((i) => i.name)).toEqual(['Fresh milk']);
  });

  it('starts with nothing, which is not the same as an empty fridge', async () => {
    expect(await latestInventory(phil)).toBeNull();
  });
});

describe('cleaning the list on the way in', () => {
  it('trims, and drops the blank rows an unfinished edit leaves behind', () => {
    expect(normaliseItems([item('  Skyr  '), item(''), item('Oats')])).toEqual([
      { name: 'Skyr', estimatedQty: '1 pack', confidence: 'high' },
      { name: 'Oats', estimatedQty: '1 pack', confidence: 'high' },
    ]);
  });

  it('does not trust a confidence the model made up', () => {
    const cleaned = normaliseItems([
      { name: 'Quark', estimatedQty: '500g', confidence: 'certain' as never },
    ]);

    expect(cleaned[0]?.confidence).toBe('medium');
  });

  it('caps the list, because a cupboard is not a decision', () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`Thing ${i}`));

    expect(normaliseItems(many)).toHaveLength(40);
  });
});

describe('one athlete cannot see into another one\'s fridge', () => {
  it('keeps the lists apart', async () => {
    const sam = await anotherAthlete();
    await saveInventory(phil, [item('Skyr')]);

    expect(await latestInventory(sam)).toBeNull();
    expect((await latestInventory(phil))?.items.map((i) => i.name)).toEqual(['Skyr']);
  });
});

describe('the generate_meal_plan tool', () => {
  const call = () => runTool(phil, { id: 'call-1', name: 'generate_meal_plan', args: {} });

  it('refuses when no fridge has ever been confirmed, and says what to do', async () => {
    const outcome = await call();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/no fridge list/i);
    expect(outcome.hint).toMatch(/do not invent/i);
  });

  it('refuses a list old enough that the food has been eaten', async () => {
    const saved = await saveInventory(phil, [item('Hähnchenbrust')]);
    await backdate(saved.id, MAX_INVENTORY_AGE_HOURS + 24);

    const outcome = await call();

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/5 days old/);
  });

  it('takes no arguments at all, so the model cannot hand it a fridge', () => {
    // The safety property of §9, expressed in the schema rather than in
    // wording: there is nowhere for an invented ingredient to enter.
    const declaration = TOOLS.find((tool) => tool.name === 'generate_meal_plan');

    expect(declaration?.parameters.properties).toEqual({});
    expect(declaration?.parameters.required ?? []).toEqual([]);
  });
});
