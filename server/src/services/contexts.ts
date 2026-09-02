import type { Ctx } from '../db';
import { badRequest, conflict, notFound } from '../errors';

export type Context = {
  id: number;
  name: string;
  equipment: Record<string, unknown>;
  foodProfile: Record<string, unknown>;
  isActive: boolean;
};

type ContextRow = {
  id: number;
  name: string;
  equipment: Record<string, unknown>;
  food_profile: Record<string, unknown>;
  is_active: boolean;
};

const toContext = (row: ContextRow): Context => ({
  id: row.id,
  name: row.name,
  equipment: row.equipment,
  foodProfile: row.food_profile,
  isActive: row.is_active,
});

// Carries the tenant predicate, like the session and food selects: callers
// append `and ...`, and a fragment that could be used unscoped does not exist.
const SELECT = `
  select id, name, equipment, food_profile, is_active from contexts
  where user_id = $1 and not archived
`;

export type SaveContextInput = {
  name: string;
  /** Free-form, read by the trainer: {gym, notes, …}. */
  equipment?: Record<string, unknown>;
  /** Free-form: {dinner, notes, …}. */
  foodProfile?: Record<string, unknown>;
};

const MAX_NAME = 60;

function cleanName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw badRequest('A place needs a name');
  if (trimmed.length > MAX_NAME) throw badRequest(`A name is at most ${MAX_NAME} characters`);
  return trimmed;
}

export async function listContexts(ctx: Ctx): Promise<Context[]> {
  const { rows } = await ctx.db.query<ContextRow>(`${SELECT} order by id`, [ctx.userId]);
  return rows.map(toContext);
}

export async function activeContext(ctx: Ctx): Promise<Context | null> {
  const { rows } = await ctx.db.query<ContextRow>(`${SELECT} and is_active limit 1`, [ctx.userId]);
  const row = rows[0];
  return row ? toContext(row) : null;
}

/**
 * Switching city. One statement, so there is never a moment with two active
 * contexts or none.
 */
export async function activateContext(ctx: Ctx, id: number): Promise<Context[]> {
  // Scoped on the way in: a context id belonging to someone else must read as
  // missing, not as a thing he is merely forbidden to switch to.
  const { rowCount } = await ctx.db.query('select 1 from contexts where id = $1 and user_id = $2', [
    id,
    ctx.userId,
  ]);
  if (!rowCount) throw notFound(`No context ${id}`);

  await ctx.db.query('update contexts set is_active = (id = $1) where user_id = $2', [
    id,
    ctx.userId,
  ]);
  return listContexts(ctx);
}

/**
 * A place he trains: home, a city he visits, the gym near work. Phil's four
 * German cities were seeded; everyone else builds their own list.
 */
export async function createContext(ctx: Ctx, input: SaveContextInput): Promise<Context[]> {
  const name = cleanName(input.name);

  const { rowCount } = await ctx.db.query(
    'select 1 from contexts where user_id = $1 and name = $2 and not archived',
    [ctx.userId, name],
  );
  if (rowCount) throw conflict(`You already have a place called ${name}`);

  await ctx.db.query(
    `insert into contexts (user_id, name, equipment, food_profile, is_active)
     values ($1, $2, $3, $4, false)`,
    [ctx.userId, name, input.equipment ?? {}, input.foodProfile ?? {}],
  );

  return listContexts(ctx);
}

/**
 * Editing one. The jsonb blobs are merged rather than replaced: the trainer
 * reads keys this endpoint has never heard of — Phil's dinner profile among
 * them — and a rename should not silently drop them.
 */
export async function updateContext(
  ctx: Ctx,
  id: number,
  input: Partial<SaveContextInput>,
): Promise<Context[]> {
  const { rows } = await ctx.db.query<ContextRow>(`${SELECT} and id = $2`, [ctx.userId, id]);
  const current = rows[0];
  if (!current) throw notFound(`No place ${id}`);

  const name = input.name === undefined ? current.name : cleanName(input.name);
  if (name !== current.name) {
    const { rowCount } = await ctx.db.query(
      'select 1 from contexts where user_id = $1 and name = $2 and id <> $3 and not archived',
      [ctx.userId, name, id],
    );
    if (rowCount) throw conflict(`You already have a place called ${name}`);
  }

  await ctx.db.query(
    `update contexts
     set name = $3,
         equipment = equipment || $4::jsonb,
         food_profile = food_profile || $5::jsonb
     where id = $2 and user_id = $1`,
    [ctx.userId, id, name, input.equipment ?? {}, input.foodProfile ?? {}],
  );

  return listContexts(ctx);
}

/**
 * Archived, never deleted: sessions carry the place they were performed in.
 * The last one cannot go — the app would have nowhere to train — and archiving
 * the active one hands the flag to another rather than leaving none active.
 */
export async function archiveContext(ctx: Ctx, id: number): Promise<Context[]> {
  const remaining = await listContexts(ctx);
  const target = remaining.find((context) => context.id === id);
  if (!target) throw notFound(`No place ${id}`);
  if (remaining.length === 1) throw badRequest('That is the only place you have.');

  await ctx.db.query(
    'update contexts set archived = true, is_active = false where id = $1 and user_id = $2',
    [id, ctx.userId],
  );

  if (target.isActive) {
    const next = remaining.find((context) => context.id !== id)!;
    await ctx.db.query('update contexts set is_active = true where id = $1 and user_id = $2', [
      next.id,
      ctx.userId,
    ]);
  }

  return listContexts(ctx);
}
