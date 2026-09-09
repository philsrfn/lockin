/**
 * Barcode lookup against OpenFoodFacts (§11).
 *
 * The phone never calls OpenFoodFacts directly — it talks only to this backend
 * (§2), which also means a scanned product gets cached into his own library and
 * the second scan of the same tub needs no network at all.
 */
import { badRequest, notFound } from '../errors';
import type { Ctx } from '../db';
import { type Food, createFood } from './foods';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';
const TIMEOUT_MS = 8000;

// OpenFoodFacts asks for a descriptive user agent so they can contact you if a
// client misbehaves. Being a good citizen of a free service costs one header.
const USER_AGENT = 'lockin/1.0 (single-user personal trainer app)';

export type BarcodeCandidate = {
  barcode: string;
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  /** True when it came from their library rather than the network. */
  known: boolean;
  /** What the numbers describe — OpenFoodFacts reports per 100g. */
  basis: string;
  brand: string | null;
  /**
   * Always 100 for a barcode: OpenFoodFacts reports per 100g, and saveScanned
   * stores it that way so the next scan can be a different portion.
   *
   * Stated rather than implied. The app used to infer the basis from `known`
   * — reading "we have seen this before" as "these numbers are a portion" —
   * and so logged 100g of anything scanned twice. See migration 027.
   */
  perGrams: number;
  /** What they ate last time. The opening offer, better than a round number. */
  lastGrams: number | null;
};

type OffProduct = {
  product_name?: string;
  product_name_de?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, number | string | undefined>;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? Number(parsed) : null;
};

export async function lookupBarcode(ctx: Ctx, barcode: string): Promise<BarcodeCandidate> {
  const code = barcode.trim();
  if (!/^\d{6,14}$/.test(code)) throw badRequest('That does not look like a barcode', 'barcode_malformed');

  // His own library first: he may have corrected the macros, and his numbers
  // should always beat the crowd-sourced ones.
  const { rows } = await ctx.db.query<{
    name: string;
    kcal: number;
    protein_g: number;
    fat_g: number | null;
    carbs_g: number | null;
    last_grams: number | null;
  }>(
    `select name, kcal, protein_g, fat_g, carbs_g, last_grams from foods
     where user_id = $1 and barcode = $2 and not archived limit 1`,
    [ctx.userId, code],
  );

  const mine = rows[0];
  if (mine) {
    return {
      barcode: code,
      name: mine.name,
      kcal: mine.kcal,
      proteinG: mine.protein_g,
      fatG: mine.fat_g,
      carbsG: mine.carbs_g,
      known: true,
      basis: 'your saved entry, per 100g',
      brand: null,
      perGrams: 100,
      lastGrams: mine.last_grams,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${ENDPOINT}/${encodeURIComponent(code)}.json?fields=product_name,product_name_de,generic_name,brands,serving_size,nutriments`,
      { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal },
    );
  } catch {
    throw badRequest('Could not reach the food database. Enter it by hand.', 'food_db_unreachable');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) throw notFound('No product with that barcode', 'barcode_unknown');
  if (!response.ok) throw badRequest('The food database is not answering right now', 'food_db_down');

  const payload = (await response.json()) as { status?: number; product?: OffProduct };
  const product = payload.product;
  if (!product || payload.status === 0) throw notFound('No product with that barcode', 'barcode_unknown');

  const n = product.nutriments ?? {};
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) ?? 0) / 4.184;
  const proteinG = num(n.proteins_100g);

  // Without energy and protein there is nothing worth logging, and a silent
  // zero would quietly corrupt the day's totals.
  if (!kcal || proteinG == null) {
    throw notFound('That product has no usable nutrition data. Enter it by hand.', 'barcode_no_nutrition');
  }

  const name =
    product.product_name_de || product.product_name || product.generic_name || `Barcode ${code}`;
  const brand = product.brands?.split(',')[0]?.trim() || null;

  return {
    barcode: code,
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name,
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: num(n.fat_100g) == null ? null : Math.round(num(n.fat_100g)!),
    carbsG: num(n.carbohydrates_100g) == null ? null : Math.round(num(n.carbohydrates_100g)!),
    known: false,
    basis: 'per 100g',
    brand,
    perGrams: 100,
    lastGrams: null,
  };
}

/** Saves a scanned product into his library so the next scan is offline. */
export async function saveScanned(
  ctx: Ctx,
  candidate: { barcode: string; name: string; kcal: number; proteinG: number; fatG?: number | null; carbsG?: number | null },
): Promise<Food> {
  const food = await createFood(ctx, {
    name: candidate.name,
    kcal: candidate.kcal,
    proteinG: candidate.proteinG,
    fatG: candidate.fatG ?? null,
    carbsG: candidate.carbsG ?? null,
    // The numbers being stored are per 100g. Saying so is the whole fix: the
    // row used to look exactly like a portion and be read as one.
    perGrams: 100,
  });
  await ctx.db.query(
    'update foods set barcode = $3 where id = $1 and user_id = $2 and barcode is null',
    [food.id, ctx.userId, candidate.barcode],
  );
  return food;
}
