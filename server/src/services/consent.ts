/**
 * Recording what somebody agreed to, and letting them take it back.
 *
 * The rule about which documents are outstanding is pure and lives in
 * `domain/consent.ts`. This is the part that touches rows.
 */
import type { Ctx } from '../db';
import { badRequest } from '../errors';
import {
  type ConsentDocument,
  DOCUMENTS,
  CURRENT_VERSIONS,
  type GivenConsent,
  missingConsents,
} from '../domain/consent';

export type ConsentState = {
  given: GivenConsent[];
  outstanding: ConsentDocument[];
  versions: Record<ConsentDocument, string>;
};

export async function consentState(ctx: Ctx): Promise<ConsentState> {
  const { rows } = await ctx.db.query<{
    document: string;
    version: string;
    agreed_at: Date;
    withdrawn_at: Date | null;
  }>(
    `select document, version, agreed_at, withdrawn_at from consents
     where user_id = $1 order by agreed_at`,
    [ctx.userId],
  );

  const given = rows.map((row) => ({
    document: row.document,
    version: row.version,
    // When they agreed, which is not the same as which notice they agreed to.
    // The screen was showing the version date under the words "agreed on".
    agreedAt: row.agreed_at,
    withdrawnAt: row.withdrawn_at,
  }));

  return { given, outstanding: missingConsents(given), versions: CURRENT_VERSIONS };
}

/**
 * Agreeing, to a named version.
 *
 * The version comes from the server rather than the client: what the app
 * believes it displayed is not evidence of what was displayed, and this row is
 * the evidence. A client sending a version we do not recognise is refused
 * rather than recorded — a consent to an unknown document is worth nothing and
 * would look like something.
 */
export async function giveConsent(
  ctx: Ctx,
  document: string,
): Promise<ConsentState> {
  if (!DOCUMENTS.includes(document as ConsentDocument)) {
    throw badRequest(`Unknown document ${document}`, 'unknown_document');
  }
  const version = CURRENT_VERSIONS[document as ConsentDocument];

  const { rows } = await ctx.db.query<{ locale: string | null }>(
    'select locale from profile where user_id = $1',
    [ctx.userId],
  );

  await ctx.db.query(
    `insert into consents (user_id, document, version, locale)
     values ($1, $2, $3, $4)
     -- Agreeing twice is not an error. Re-agreeing after a withdrawal is a
     -- fresh consent, and the timestamp moves with it.
     on conflict (user_id, document, version) do update
       set agreed_at = now(), withdrawn_at = null`,
    [ctx.userId, document, version, rows[0]?.locale ?? null],
  );

  return consentState(ctx);
}

/**
 * Taking it back, which must be as easy as giving it.
 *
 * The row stays and gets a `withdrawn_at`. Deleting it would erase the
 * evidence that the consent was ever lawfully obtained, which is the opposite
 * of what the obligation asks for — and the athlete's actual data is erased by
 * deleting the account, which is a different button and says so.
 */
export async function withdrawConsent(ctx: Ctx, document: string): Promise<ConsentState> {
  if (!DOCUMENTS.includes(document as ConsentDocument)) {
    throw badRequest(`Unknown document ${document}`, 'unknown_document');
  }

  await ctx.db.query(
    `update consents set withdrawn_at = now()
     where user_id = $1 and document = $2 and withdrawn_at is null`,
    [ctx.userId, document],
  );

  return consentState(ctx);
}
