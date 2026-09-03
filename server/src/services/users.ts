/**
 * Users, and what a new one starts with.
 *
 * Authentication is still one long-lived token per person, held in the iOS
 * keychain — but the token now identifies a row rather than matching a single
 * environment variable, which is the whole difference between "one user" and
 * "a handful of friends". Sign in with Apple replaces this; the storage
 * underneath it does not change.
 */
import { createHash, randomBytes } from 'node:crypto';
import { type Ctx, type Queryable, ctxFor, pool, queryOne, transaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { DEFAULT_TIME_ZONE } from '../domain/time';

export type User = {
  id: number;
  name: string | null;
  email: string | null;
  /** May reach the admin panel. Granted in the database, by no route. */
  isAdmin: boolean;
  /** Null means the account exists but has not been let in yet. */
  approvedAt: Date | null;
};

/** Tokens are stored hashed. A database dump must not be a set of passwords. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Resolves a bearer token to an athlete.
 *
 * Two places to look, because there are two ways a token gets issued. Signing
 * in with Apple mints one per device, so an iPad does not sign the phone out.
 * `users.token_hash` is the older, one-per-person token — Phil's, and the ones
 * the CLI prints — and it keeps working untouched.
 */
export async function findUserByToken(token: string, db: Queryable = pool): Promise<User | null> {
  const hash = hashToken(token);

  const { rows } = await db.query<User>(
    `select u.id, u.name, u.email, u.is_admin as "isAdmin", u.approved_at as "approvedAt"
     from users u
     left join sessions_tokens s on s.user_id = u.id and s.token_hash = $1
     where u.token_hash = $1 or s.id is not null
     limit 1`,
    [hash],
  );

  const user = rows[0];
  if (!user) return null;

  // Best effort: knowing when a device last spoke is what makes revoking one
  // possible later. Never let it fail a sign-in.
  void db
    .query('update sessions_tokens set last_used_at = now() where token_hash = $1', [hash])
    .catch(() => undefined);

  return user;
}

/**
 * A new long-lived token for one device. Returned once and stored only as a
 * hash — a database dump is not a set of passwords.
 */
export async function issueToken(
  userId: number,
  options: { source?: string; device?: string | null } = {},
  db: Queryable = pool,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await db.query(
    'insert into sessions_tokens (user_id, token_hash, source, device) values ($1, $2, $3, $4)',
    [userId, hashToken(token), options.source ?? 'apple', options.device ?? null],
  );

  return token;
}

/** Signing out this device, and only this device. */
export async function revokeToken(token: string, db: Queryable = pool): Promise<void> {
  await db.query('delete from sessions_tokens where token_hash = $1', [hashToken(token)]);
}

export type AppleSignIn = {
  /** Apple's stable id for this person in this app. */
  sub: string;
  email: string | null;
  /** Apple sends a name only on the very first authorisation, if at all. */
  name?: string | null;
  timezone?: string;
  locale?: string;
};

/**
 * Finds the athlete behind an Apple id, or makes one.
 *
 * Keyed on `sub` and never on email: Apple's relay addresses change, the email
 * can be withheld, and it is only sent on the first authorisation — so an
 * athlete who hid their address would otherwise get a new account every time
 * they signed in.
 */
/**
 * Note what is not passed: `approved`. Anybody with the TestFlight link can
 * reach this, and every account costs money the moment it talks to the
 * trainer, so an account that let itself in starts pending. One provisioned by
 * the CLI does not — the operator typing the command is the approval.
 */
export async function findOrCreateAppleUser(
  input: AppleSignIn,
): Promise<{ user: User; isNew: boolean }> {
  const existing = await queryOne<User>(
    'select id, name, email, is_admin as "isAdmin", approved_at as "approvedAt" from users where apple_sub = $1',
    [input.sub],
  );

  if (existing) {
    // Fill in anything we learned later without overwriting what they set.
    if (input.email && !existing.email) {
      await pool.query('update users set email = coalesce(email, $2) where id = $1', [
        existing.id,
        input.email,
      ]);
    }
    return { user: existing, isNew: false };
  }

  const { user } = await provisionUser({
    name: input.name ?? null,
    email: input.email ?? null,
    appleSub: input.sub,
    timezone: input.timezone,
    locale: input.locale,
  });

  return { user, isNew: true };
}

export async function getUser(id: number, db: Queryable = pool): Promise<User> {
  const { rows } = await db.query<User>(
    'select id, name, email, is_admin as "isAdmin", approved_at as "approvedAt" from users where id = $1',
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
  /** Apple's stable id, when they arrived through Sign in with Apple. */
  appleSub?: string | null;
  /**
   * Let in immediately. True for an account the operator created by hand —
   * typing the command is the approval. Left false for anybody who signed
   * themselves in, who waits for the admin panel.
   */
  approved?: boolean;
  locale?: string | null;
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
    const { rows } = await db.query<User>(
      `insert into users (name, email, token_hash, apple_sub, approved_at)
       values ($1, $2, $3, $4, $5)
       returning id, name, email, is_admin as "isAdmin", approved_at as "approvedAt"`,
      [
        input.name ?? null,
        input.email ?? null,
        input.token ? hashToken(input.token) : null,
        input.appleSub ?? null,
        input.approved ? new Date() : null,
      ],
    );
    const user = rows[0]!;

    await db.query(
      `insert into profile
         (user_id, name, timezone, locale, height_cm, calorie_target, protein_target_g, fat_floor_g)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      // Placeholders, not targets. `onboarded_at` stays null until the
      // questionnaire is answered, and the app routes to onboarding on that —
      // so these numbers are never shown to anybody. Computing real ones needs
      // a sex, an age and a goal, which is exactly what onboarding collects.
      [
        user.id,
        input.name ?? null,
        input.timezone ?? DEFAULT_TIME_ZONE,
        input.locale ?? null,
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

/**
 * How this account was created, which decides whether the app offers to delete
 * it. An account made by signing in with Apple is that person's to remove —
 * the App Store requires it be removable from inside the app. A root token was
 * provisioned by whoever runs the server, and is theirs to withdraw; a delete
 * button on it would be one tap between Phil and every session he has logged.
 */
export async function accountKind(userId: number, db: Queryable = pool): Promise<'apple' | 'root'> {
  const { rows } = await db.query<{ apple: boolean }>(
    'select apple_sub is not null and token_hash is null as apple from users where id = $1',
    [userId],
  );
  return rows[0]?.apple ? 'apple' : 'root';
}

/**
 * Erases an athlete. Every owned table declares `on delete cascade`, so this
 * one statement takes the sessions, sets, weigh-ins, meals, chat and tokens
 * with it. There is no soft delete and no grace period: somebody asking to be
 * forgotten should be forgotten.
 */
export async function deleteAccount(userId: number, db: Queryable = pool): Promise<void> {
  if ((await accountKind(userId, db)) !== 'apple') {
    throw badRequest(
      'This account was provisioned with a server token rather than by signing in. ' +
        'Whoever runs the server removes it.',
    );
  }

  await db.query('delete from users where id = $1', [userId]);
}


export type AppleLink = { linked: true; email: string | null } ;

/**
 * Attaching an Apple ID to an account that already exists.
 *
 * Without this, an athlete who has been using a hand-issued token and then
 * signs in with Apple on a new phone does not sign in at all — there is no row
 * with that `apple_sub`, so a second, empty account is created and their
 * training history stays behind on the old one. This is the step that makes
 * the two the same person.
 *
 * The token they already hold keeps working. Linking adds a way in; it does
 * not replace one.
 */
export async function linkAppleAccount(
  userId: number,
  input: { sub: string; email?: string | null },
): Promise<AppleLink> {
  const owner = await queryOne<{ id: number }>('select id from users where apple_sub = $1', [
    input.sub,
  ]);

  if (owner && owner.id !== userId) {
    throw conflict('That Apple ID is already signed in to another account here.');
  }

  const current = await queryOne<{ apple_sub: string | null }>(
    'select apple_sub from users where id = $1',
    [userId],
  );
  if (!current) throw notFound(`No user ${userId}`);

  if (current.apple_sub && current.apple_sub !== input.sub) {
    // Silently swapping which Apple ID opens an account is the kind of change
    // somebody should have to undo deliberately.
    throw conflict(
      'This account is already linked to a different Apple ID. Unlink it first.',
    );
  }

  const { rows } = await pool.query<{ email: string | null }>(
    `update users
     set apple_sub = $2,
         -- Apple sends the email once, on the first authorisation. Take it if
         -- we have none, never over the top of one they chose.
         email = coalesce(email, $3)
     where id = $1
     returning email`,
    [userId, input.sub, input.email ?? null],
  );

  return { linked: true, email: rows[0]?.email ?? null };
}

/**
 * Removing the Apple ID again. Refused when it is the only way in, because the
 * alternative is an account nobody can open.
 */
export async function unlinkAppleAccount(userId: number): Promise<void> {
  const row = await queryOne<{ has_token: boolean }>(
    'select token_hash is not null as has_token from users where id = $1',
    [userId],
  );
  if (!row) throw notFound(`No user ${userId}`);

  if (!row.has_token) {
    throw badRequest(
      'Signing in with Apple is the only way into this account. Unlinking it would lock you out.',
    );
  }

  await pool.query('update users set apple_sub = null where id = $1', [userId]);
}

/** Whether this account can be opened with Apple on a new device. */
export async function appleLinked(userId: number, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query<{ linked: boolean }>(
    'select apple_sub is not null as linked from users where id = $1',
    [userId],
  );
  return rows[0]?.linked ?? false;
}
