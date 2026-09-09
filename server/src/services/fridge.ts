/**
 * The confirmed fridge list — §9 step 4, which the table has been waiting for
 * since migration 001.
 *
 * `fridge_inventory` existed, carried a user_id, and was named in the tenancy
 * guard, but nothing ever wrote a row: the Fridge screen held the list in
 * component state and posted it straight to the planner. That worked for the
 * one flow it was built for and made the list invisible to everything else —
 * in particular to the trainer, who could be told "plan me dinner" in chat and
 * had nothing to plan from.
 *
 * So confirmation is now durable. The write happens at the moment the athlete
 * confirms, which is the only moment §9 accepts as evidence of what is
 * actually in the fridge.
 */
import type { Ctx } from '../db';
import { badRequest } from '../errors';

export type FridgeItem = {
  name: string;
  estimatedQty: string;
  confidence: 'low' | 'medium' | 'high';
};

export type Inventory = {
  id: number;
  capturedAt: string;
  /** Where they were when they photographed it. Null if no place is active. */
  contextName: string | null;
  items: FridgeItem[];
};

type InventoryRow = {
  id: number;
  captured_at: Date;
  context_name: string | null;
  items: FridgeItem[];
};

const SELECT = `
  select i.id, i.captured_at, c.name as context_name, i.items
  from fridge_inventory i
  left join contexts c on c.id = i.context_id and c.user_id = i.user_id
  where i.user_id = $1
`;

const toInventory = (row: InventoryRow): Inventory => ({
  id: row.id,
  capturedAt: row.captured_at.toISOString(),
  contextName: row.context_name,
  // A row written before this shape settled, or by hand, should not crash a
  // read. An unreadable list is an empty one, which the planner refuses.
  items: Array.isArray(row.items) ? row.items : [],
});

/**
 * Clean the list on the way in.
 *
 * The items arrive from a vision pass the athlete has edited, so they are
 * partly the model's words and partly theirs. Neither is trusted to be the
 * right shape, and a blank row is what an unfinished edit looks like.
 */
export function normaliseItems(items: FridgeItem[]): FridgeItem[] {
  return items
    .map((item) => ({
      name: String(item.name ?? '').trim().slice(0, 80),
      estimatedQty: String(item.estimatedQty ?? '').trim().slice(0, 40),
      confidence: (['low', 'medium', 'high'] as const).includes(item.confidence)
        ? item.confidence
        : ('medium' as const),
    }))
    .filter((item) => item.name.length > 0)
    // The same ceiling the planner already applied. A list longer than this is
    // a cupboard, not a decision.
    .slice(0, 40);
}

export async function saveInventory(ctx: Ctx, items: FridgeItem[]): Promise<Inventory> {
  const cleaned = normaliseItems(items);
  if (cleaned.length === 0) throw badRequest('An empty list is not a fridge', 'fridge_empty');

  const { rows } = await ctx.db.query<{ id: number }>(
    `insert into fridge_inventory (user_id, captured_at, context_id, items)
     values ($1, now(), (select id from contexts where user_id = $1 and is_active limit 1), $2)
     returning id`,
    [ctx.userId, JSON.stringify(cleaned)],
  );

  const saved = await byId(ctx, rows[0]!.id);
  // The insert just succeeded under this user_id, so the read cannot miss.
  return saved!;
}

async function byId(ctx: Ctx, id: number): Promise<Inventory | null> {
  const { rows } = await ctx.db.query<InventoryRow>(`${SELECT} and i.id = $2`, [ctx.userId, id]);
  return rows[0] ? toInventory(rows[0]) : null;
}

/**
 * The most recent confirmed list, whatever its age. Deciding whether it is
 * still worth planning from is `domain/fridge.ts`, not this function — the
 * caller may want to say how old it is rather than pretend it does not exist.
 */
export async function latestInventory(ctx: Ctx): Promise<Inventory | null> {
  const { rows } = await ctx.db.query<InventoryRow>(
    `${SELECT} order by i.captured_at desc, i.id desc limit 1`,
    [ctx.userId],
  );
  return rows[0] ? toInventory(rows[0]) : null;
}
