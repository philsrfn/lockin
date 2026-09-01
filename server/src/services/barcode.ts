/**
 * Barcode lookup against OpenFoodFacts (§11).
 *
 * The phone never calls OpenFoodFacts directly — it talks only to this backend
 * (§2), which also means a scanned product gets cached into his own library and
 * the second scan of the same tub needs no network at all.
 */
import { badRequest, notFound } from '../errors';
import { type Queryable, pool } from '../db';
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
  /** True when it came from his library rather than the network. */
  known: boolean;
  /** What the numbers describe — OpenFoodFacts reports per 100g. */
  basis: string;
  brand: string | null;
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

export async function lookupBarcode(
  barcode: string,
  db: Queryable = pool,
): Promise<BarcodeCandidate> {
  const code = barcode.trim();
  if (!/^\d{6,14}$/.test(code)) throw badRequest('That does not look like a barcode');

  // His own library first: he may have corrected the macros, and his numbers
  // should always beat the crowd-sourced ones.
  const { rows } = await db.query<{
    name: string;
    kcal: number;
    protein_g: number;
    fat_g: number | null;
    carbs_g: number | null;
  }>(
    `select name, kcal, protein_g, fat_g, carbs_g from foods
     where barcode = $1 and not archived limit 1`,
    [code],
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
      basis: 'your saved entry',
      brand: null,
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
    throw badRequest('Could not reach the food database. Enter it by hand.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) throw notFound('No product with that barcode');
  if (!response.ok) throw badRequest('The food database is not answering right now');

  const payload = (await response.json()) as { status?: number; product?: OffProduct };
  const product = payload.product;
  if (!product || payload.status === 0) throw notFound('No product with that barcode');

  const n = product.nutriments ?? {};
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) ?? 0) / 4.184;
  const proteinG = num(n.proteins_100g);

  // Without energy and protein there is nothing worth logging, and a silent
  // zero would quietly corrupt the day's totals.
  if (!kcal || proteinG == null) {
    throw notFound('That product has no usable nutrition data. Enter it by hand.');
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
  };
}

/** Saves a scanned product into his library so the next scan is offline. */
export async function saveScanned(
  candidate: { barcode: string; name: string; kcal: number; proteinG: number; fatG?: number | null; carbsG?: number | null },
  db: Queryable = pool,
): Promise<Food> {
  const food = await createFood(
    {
      name: candidate.name,
      kcal: candidate.kcal,
      proteinG: candidate.proteinG,
      fatG: candidate.fatG ?? null,
      carbsG: candidate.carbsG ?? null,
    },
    db,
  );
  await db.query('update foods set barcode = $2 where id = $1 and barcode is null', [
    food.id,
    candidate.barcode,
  ]);
  return food;
}
