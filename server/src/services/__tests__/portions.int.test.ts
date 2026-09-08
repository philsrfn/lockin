/**
 * The bug this file exists for.
 *
 * `foods` rows were portions, except the ones with a barcode, which held
 * per-100g figures with nothing saying so. Both readers guessed, and both
 * guessed the same way: scanning a product a second time logged 100g of it
 * with the grams field hidden, and tapping its tile in the library did the
 * same through a different door.
 *
 * Neither threw. They wrote a plausible number into the food log, which is
 * what remaining protein, the deficit and the Sunday review are computed
 * from — so these tests are about the log being *right*, not about an error
 * message being nice.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { buildServer } from '../../index';
import { TEST_BEARER_TOKEN } from '../../test/database';
import { resetData, resetProfile } from '../../test/helpers';
import { syncRootToken } from '../users';
import { resetBuckets } from '../../rateLimit';

let app: FastifyInstance;
const auth = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

beforeAll(async () => {
  await syncRootToken(TEST_BEARER_TOKEN);
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetData();
  await resetProfile();
  resetBuckets();
});

/** Saves a scanned product the way the app does after a successful lookup. */
async function scanAndSave(): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/foods/scanned',
    headers: auth,
    // Skyr, per 100g, as OpenFoodFacts reports it.
    payload: { barcode: '5701234567890', name: 'Skyr Natur', kcal: 62, proteinG: 10, fatG: 0, carbsG: 4 },
  });
  expect(response.statusCode).toBe(201);
  return response.json().food.id;
}

const log = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/meals/from-food', headers: auth, payload });

describe('a scanned product knows it is measured by weight', () => {
  it('says so, so the app never has to infer it', async () => {
    await scanAndSave();

    const { foods } = (
      await app.inject({ method: 'GET', url: '/foods', headers: auth })
    ).json();
    const skyr = foods.find((food: { name: string }) => food.name === 'Skyr Natur');

    expect(skyr.perGrams).toBe(100);
  });

  it('comes back per 100g on the second scan, not as a portion', async () => {
    await scanAndSave();

    const { candidate } = (
      await app.inject({
        method: 'GET',
        url: '/foods/barcode?barcode=5701234567890',
        headers: auth,
      })
    ).json();

    // `known` says where it came from. It has never said what the numbers
    // mean, and reading it that way is what caused the bug.
    expect(candidate.known).toBe(true);
    expect(candidate.perGrams).toBe(100);
  });
});

describe('logging a food measured by weight', () => {
  it('refuses without a portion instead of assuming one', async () => {
    const foodId = await scanAndSave();

    const response = await log({ foodId, slot: 'breakfast' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/how many grams/i);
  });

  it('logs what was actually eaten', async () => {
    const foodId = await scanAndSave();

    const response = await log({ foodId, slot: 'breakfast', grams: 500 });

    expect(response.statusCode).toBe(201);
    // 500 g of 62 kcal / 10 g protein per 100 g.
    expect(response.json().meal).toMatchObject({ kcal: 310, proteinG: 50 });
  });

  it('puts the weight in the description, so it can be checked afterwards', async () => {
    const foodId = await scanAndSave();

    const { meal } = (await log({ foodId, grams: 250 })).json();

    expect(meal.description).toBe('Skyr Natur (250 g)');
  });

  it('remembers the portion, so next time opens on it', async () => {
    const foodId = await scanAndSave();
    await log({ foodId, grams: 250 });

    const { candidate } = (
      await app.inject({
        method: 'GET',
        url: '/foods/barcode?barcode=5701234567890',
        headers: auth,
      })
    ).json();

    expect(candidate.lastGrams).toBe(250);
  });

  it('refuses a portion nobody could eat', async () => {
    const foodId = await scanAndSave();

    expect((await log({ foodId, grams: 9000 })).statusCode).toBe(400);
    expect((await log({ foodId, grams: 0 })).statusCode).toBe(400);
  });
});

describe('a food that is already a portion still logs in one tap', () => {
  async function savePortionFood(): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/foods',
      headers: auth,
      payload: { name: 'Protein shake', kcal: 310, proteinG: 50, quickAdd: true },
    });
    expect(response.statusCode).toBe(201);
    return response.json().food.id;
  }

  it('logs as it stands, with no grams asked for', async () => {
    const foodId = await savePortionFood();

    const response = await log({ foodId, slot: 'snack' });

    expect(response.statusCode).toBe(201);
    expect(response.json().meal).toMatchObject({
      description: 'Protein shake',
      kcal: 310,
      proteinG: 50,
    });
  });

  it('carries no basis, which is what makes it a portion', async () => {
    await savePortionFood();

    const { foods } = (
      await app.inject({ method: 'GET', url: '/foods', headers: auth })
    ).json();

    expect(foods.find((f: { name: string }) => f.name === 'Protein shake').perGrams).toBeNull();
  });
});

describe('editing a scanned food', () => {
  it('keeps it measured by weight, and says so in the reply', async () => {
    // Correcting the macros of a scanned product is a normal thing to do. It
    // must not quietly turn the row back into a portion — and the reply has
    // to carry the basis, or the screen it updates believes it did.
    const foodId = await scanAndSave();

    const response = await app.inject({
      method: 'PATCH',
      url: `/foods/${foodId}`,
      headers: auth,
      payload: { kcal: 64 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().food).toMatchObject({ kcal: 64, perGrams: 100 });
  });
});
