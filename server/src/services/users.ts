/**
 * Users, and what a new one starts with.
 *
 * Authentication is still one long-lived token per person, held in the iOS
 * keychain — but the token now identifies a row rather than matching a single
 * environment variable, which is the whole difference between "one user" and
 * "a handful of friends". Sign in with Apple replaces this; the storage
 * underneath it does not change.
 */
import { createHash } from 'node:crypto';
import { type Ctx, type Queryable, ctxFor, pool, transaction } from '../db';
import { badRequest, notFound } from '../errors';
import { DEFAULT_TIME_ZONE } from '../domain/time';

export type User = {
  id: number;
  name: string | null;
  email: string | null;
};

/** Tokens are stored hashed. A database dump must not be a set of passwords. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export async function findUserByToken(token: string, db: Queryable = pool): Promise<User | null> {
  const { rows } = await db.query<{ id: number; name: string | null; email: string | null }>(
    'select id, name, email from users where token_hash = $1',
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function getUser(id: number, db: Queryable = pool): Promise<User> {
  const { rows } = await db.query<{ id: number; name: string | null; email: string | null }>(
    'select id, name, email from users where id = $1',
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(`No user ${id}`);
  return row;
}

/**
 * The rules from §5, seeded for every new athlete. The four with a `code` are
 * the ones the validator can actually enforce; the rest reach the model as
 * text. That distinction is deliberate and surfaced in the app.
 */
const SEED_RULES: { tier: string; text: string; code: string | null }[] = [
  {
    tier: 'never',
    text: 'Never propose a day under 160g protein.',
    code: 'min_daily_protein',
  },
  {
    tier: 'never',
    text: 'Never schedule hard intervals on a football day.',
    code: 'no_intervals_on_football_day',
  },
  {
    tier: 'soft',
    text: 'Weekly movement targets, not fixed weekdays — travel makes fixed days fail.',
    code: 'weekly_targets_not_weekdays',
  },
];

const SEED_JOBS: [string, number, number, number | null][] = [
  ['morning_checkin', 7, 30, null],
  ['dinner_prompt', 20, 0, null],
  ['weekly_review', 18, 0, 0],
  ['log_nudge', 0, 0, null],
];

export type NewUser = {
  name?: string | null;
  email?: string | null;
  /** The bearer token this person will use. Stored only as a hash. */
  token?: string;
  timezone?: string;
  heightCm?: number;
  calorieTarget?: number;
  proteinTargetG?: number;
  fatFloorG?: number;
};

/**
 * Creates an athlete and everything they need to open the app: a profile, one
 * training context, the enforceable rules, and a notification schedule.
 *
 * Deliberately not Phil's four German cities or his Skyr breakfast. Those are
 * his, and handing them to a stranger is Phase 2's problem to solve properly —
 * seeding them here would be worse than seeding nothing.
 */
export async function provisionUser(input: NewUser = {}): Promise<{ user: User; ctx: Ctx }> {
  if (input.email && !input.email.includes('@')) throw badRequest('That is not an email address');

  return transaction(async (db) => {
    const { rows } = await db.query<{ id: number; name: string | null; email: string | null }>(
      `insert into users (name, email, token_hash) values ($1, $2, $3)
       returning id, name, email`,
      [input.name ?? null, input.email ?? null, input.token ? hashToken(input.token) : null],
    );
    const user = rows[0]!;

    await db.query(
      `insert into profile
         (user_id, name, timezone, height_cm, calorie_target, protein_target_g, fat_floor_g)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.id,
        input.name ?? null,
        input.timezone ?? DEFAULT_TIME_ZONE,
        input.heightCm ?? 175,
        input.calorieTarget ?? 2300,
        input.proteinTargetG ?? 170,
        input.fatFloorG ?? 60,
      ],
    );

    await db.query(
      `insert into contexts (user_id, name, equipment, food_profile, is_active)
       values ($1, 'Home', '{"gym": true}', '{}', true)`,
      [user.id],
    );

    for (const rule of SEED_RULES) {
      await db.query(
        'insert into rules (user_id, tier, text, code, active) values ($1, $2, $3, $4, true)',
        [user.id, rule.tier, rule.text, rule.code],
      );
    }

    for (const [job, hour, minute, dow] of SEED_JOBS) {
      await db.query(
        'insert into job_schedule (user_id, job, hour, minute, day_of_week) values ($1, $2, $3, $4, $5)',
        [user.id, job, hour, minute, dow],
      );
    }

    return { user, ctx: ctxFor(user.id, db) };
  });
}

/**
 * Keeps the deployed bearer token working as user 1's token. The env var is
 * still the source of truth for his phone; this only mirrors its hash into the
 * table so authentication has one code path for everybody.
 */
export async function syncRootToken(token: string, db: Queryable = pool): Promise<void> {
  await db.query('update users set token_hash = $1 where id = 1', [hashToken(token)]);
}

/** Every athlete the scheduler has to sweep. */
export async function listUserIds(db: Queryable = pool): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>('select id from users order by id');
  return rows.map((row) => row.id);
}
