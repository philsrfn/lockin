/**
 * Reading and setting what an account is entitled to.
 *
 * The rule is pure and lives in `domain/entitlement.ts`. This is the row.
 */
import type { Ctx } from '../db';
import { crossTenant } from '../db';
import { badRequest } from '../errors';
import { type Access, type Entitlement, accessFor, trialExpiry } from '../domain/entitlement';
import { env } from '../env';

type Row = { kind: string; expires_at: Date | null };

const toEntitlement = (row: Row | undefined): Entitlement | null =>
  row ? { kind: row.kind as Entitlement['kind'], expiresAt: row.expires_at } : null;

export async function entitlementFor(ctx: Ctx): Promise<Entitlement | null> {
  const { rows } = await ctx.db.query<Row>(
    'select kind, expires_at from entitlements where user_id = $1',
    [ctx.userId],
  );
  return toEntitlement(rows[0]);
}

export async function accessForAthlete(ctx: Ctx): Promise<Access> {
  return accessFor(await entitlementFor(ctx));
}

/**
 * The trial a new account starts on.
 *
 * Written during provisioning, in the same transaction as the profile, so an
 * account cannot exist without one — a missing row means no trainer, and
 * somebody's first minute in the app is not the moment to discover a race.
 */
export async function grantSignupTrial(db: Ctx['db'], userId: number): Promise<void> {
  await db.query(
    `insert into entitlements (user_id, kind, expires_at, source)
     values ($1, 'trial', $2, 'signup')
     on conflict (user_id) do nothing`,
    [userId, trialExpiry(env.trialDays)],
  );
}

/**
 * An operator granting or extending one.
 *
 * This is how money that arrives outside the App Store becomes access — a
 * bank transfer, a friend, a refund being honoured. It crosses tenants
 * because an operator is not the athlete, and every route that reaches it is
 * behind `requireAdmin`.
 */
export async function grant(
  actorId: number,
  subjectId: number,
  input: { kind: Entitlement['kind']; days: number | null },
): Promise<void> {
  if (input.kind !== 'comped' && input.days == null) {
    throw badRequest('Only a comped entitlement may run forever', 'needs_expiry');
  }

  await crossTenant(async (db) => {
    await db.query(
      `insert into entitlements (user_id, kind, expires_at, source)
       values ($1, $2, $3, 'operator')
       on conflict (user_id) do update
         set kind = excluded.kind, expires_at = excluded.expires_at,
             source = excluded.source, updated_at = now()`,
      [subjectId, input.kind, input.days == null ? null : trialExpiry(input.days)],
    );
    // The ledger the one row deliberately is not. `admin_actions` already
    // records who decided what, and an entitlement is a decision.
    await db.query(
      `insert into admin_actions (actor_id, subject_id, action, detail)
       values ($1, $2, 'entitle', $3)`,
      [actorId, subjectId, JSON.stringify(input)],
    );
  });
}
