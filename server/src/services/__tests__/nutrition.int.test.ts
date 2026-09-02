/**
 * Meals and the food library.
 *
 * §11: no general nutrition database. The library grows by use, the daily
 * totals are arithmetic done in code, and protein remaining is the hero number
 * — so the thing that must never break is the sum.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetData, resetProfile } from '../../test/helpers';
import { archiveFood, createFood, getFood, listFoods, updateFood } from '../foods';
import { deleteMeal, logMeal, macrosToday, mealsToday } from '../meals';

beforeEach(async () => {
  await resetData();
  await resetProfile();
});

const SKYR = {
  name: 'Skyr breakfast',
  kcal: 520,
  proteinG: 55,
  fatG: 6,
  carbsG: 55,
  quickAdd: true,
  defaultSlot: 'breakfast' as const,
};

describe('logMeal', () => {
  it('records the meal and returns what today looks like afterwards', async () => {
    const result = await logMeal({
      slot: 'breakfast',
      description: 'Skyr, berries, 40g oats',
      kcal: 520,
      proteinG: 55,
      fatG: 6,
      carbsG: 55,
    });

    expect(result.meal.slot).toBe('breakfast');
    expect(result.today).toEqual({ kcal: 520, proteinG: 55, fatG: 6, carbsG: 55 });
  });

  it('sums the day across meals, including fat and carbs', async () => {
    await logMeal({ slot: 'breakfast', description: 'Skyr', kcal: 520, proteinG: 55, fatG: 6, carbsG: 55 });
    await logMeal({ slot: 'lunch', description: 'Soy bowl', kcal: 700, proteinG: 60, fatG: 20, carbsG: 70 });

    expect(await macrosToday()).toEqual({ kcal: 1220, proteinG: 115, fatG: 26, carbsG: 125 });
  });

  it('treats a meal logged without macros as zero, not as a missing day', async () => {
    await logMeal({ slot: 'snack', description: 'a handful of nuts, unweighed' });

    const meals = await mealsToday();

    expect(meals).toHaveLength(1);
    expect(meals[0]?.proteinG).toBeNull();
    expect(await macrosToday()).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  });

  it('defaults the source to his own cooking', async () => {
    const result = await logMeal({ slot: 'dinner', description: 'own' });

    expect(result.meal.source).toBe('own');
  });

  it('rejects a slot that is not one of the four', async () => {
    await expect(
      logMeal({ slot: 'brunch' as 'lunch', description: 'x' }),
    ).rejects.toThrow('slot must be one of breakfast, lunch, dinner, snack');
  });

  it('counts a food towards its use count so the library reorders itself', async () => {
    const food = await createFood(SKYR);

    await logMeal({ slot: 'breakfast', description: food.name, foodId: food.id, proteinG: 55 });
    await logMeal({ slot: 'snack', description: food.name, foodId: food.id, proteinG: 55 });

    expect((await getFood(food.id)).timesUsed).toBe(2);
  });

  it('yesterday does not count towards today', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    await logMeal({
      slot: 'dinner',
      description: 'yesterday',
      proteinG: 60,
      eatenAt: yesterday.toISOString(),
    });

    expect(await mealsToday()).toEqual([]);
    expect((await macrosToday()).proteinG).toBe(0);
  });
});

describe('deleteMeal', () => {
  it('undoes a mis-tap and hands back the corrected total', async () => {
    await logMeal({ slot: 'breakfast', description: 'Skyr', proteinG: 55 });
    const mistake = await logMeal({ slot: 'breakfast', description: 'Skyr again', proteinG: 55 });

    const after = await deleteMeal(mistake.meal.id);

    expect(after.today.proteinG).toBe(55);
  });

  it('404s on a meal that is already gone', async () => {
    await expect(deleteMeal(9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('the food library', () => {
  it('saves a food and reads it back', async () => {
    const food = await createFood(SKYR);

    expect(food).toMatchObject({ name: 'Skyr breakfast', kcal: 520, proteinG: 55, quickAdd: true });
    expect(food.timesUsed).toBe(0);
  });

  it('saving the same name twice updates it rather than failing', async () => {
    const first = await createFood(SKYR);
    const second = await createFood({ ...SKYR, kcal: 540 });

    expect(second.id).toBe(first.id);
    expect(second.kcal).toBe(540);
    expect(await listFoods()).toHaveLength(1);
  });

  it('matches that name case-insensitively — he is not thinking about primary keys', async () => {
    await createFood(SKYR);
    const again = await createFood({ ...SKYR, name: 'skyr BREAKFAST' });

    expect(await listFoods()).toHaveLength(1);
    // The upsert keeps the name he first chose. A hurried all-lowercase entry
    // at 6am should not recase the library.
    expect(again.name).toBe('Skyr breakfast');
  });

  it.each([
    ['a blank name', { name: '   ' }, 'A food needs a name'],
    ['kcal that is not a number', { kcal: Number.NaN }, 'kcal must be a number'],
    ['negative protein', { proteinG: -5 }, 'proteinG must be a number'],
  ])('rejects %s', async (_label, override, message) => {
    await expect(createFood({ ...SKYR, ...override })).rejects.toThrow(message);
  });

  it('rounds macros to whole numbers — vegetables do not need decimals', async () => {
    const food = await createFood({ ...SKYR, kcal: 519.6, proteinG: 54.4 });

    expect(food.kcal).toBe(520);
    expect(food.proteinG).toBe(54);
  });

  it('puts quick-add tiles first, then whatever he reached for most recently', async () => {
    const skyr = await createFood(SKYR);
    const bowl = await createFood({ name: 'Soy chunk bowl', kcal: 700, proteinG: 60 });
    await createFood({ name: 'Magerquark 200g', kcal: 140, proteinG: 24 });

    await logMeal({ slot: 'lunch', description: 'bowl', foodId: bowl.id });

    const listed = await listFoods();

    expect(listed[0]?.id).toBe(skyr.id);
    expect(listed[1]?.id).toBe(bowl.id);
  });

  it('edits a food without needing every field restated', async () => {
    const food = await createFood(SKYR);

    const updated = await updateFood(food.id, { kcal: 480 });

    expect(updated.kcal).toBe(480);
    expect(updated.proteinG).toBe(55);
    expect(updated.name).toBe('Skyr breakfast');
    expect(updated.quickAdd).toBe(true);
  });

  it('can clear an optional macro back to unknown', async () => {
    const food = await createFood(SKYR);

    expect((await updateFood(food.id, { fatG: null })).fatG).toBeNull();
  });

  it('archives rather than deletes, so logged meals keep their history', async () => {
    const food = await createFood(SKYR);
    const meal = await logMeal({ slot: 'breakfast', description: 'Skyr', foodId: food.id });

    await archiveFood(food.id);

    expect(await listFoods()).toEqual([]);
    await expect(getFood(food.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await mealsToday())[0]?.foodId).toBe(meal.meal.foodId);
  });

  it('frees the name once a food is archived', async () => {
    const first = await createFood(SKYR);
    await archiveFood(first.id);

    const replacement = await createFood(SKYR);

    expect(replacement.id).not.toBe(first.id);
  });

  it('404s when archiving something that is not there', async () => {
    await expect(archiveFood(9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
