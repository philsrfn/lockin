/**
 * What a verified App Store transaction does to an entitlement.
 *
 * Pure, per §1 and for a plainer reason: this is the function that decides
 * whether somebody can use what they paid for, and it has to be testable
 * without a signed JWS, an Apple certificate chain, or a sandbox account.
 * Verification is somebody else's job (`apple/storeKit.ts`); by the time a
 * transaction reaches here it is already known to have come from Apple.
 *
 * WHAT APPLE SENDS AND WHAT IS DONE WITH IT
 *
 * A transaction carries a product, an expiry, and — when money has been given
 * back — a revocation date. Renewals arrive as new transactions against the
 * same `originalTransactionId`, which is why that, and not the transaction id,
 * is what an account is matched on.
 *
 * NOTIFICATIONS ARRIVE OUT OF ORDER
 *
 * Apple retries a notification it did not get a 200 for, and a retry of last
 * month's renewal can land after this month's. So an expiry only ever moves
 * forward. The one thing allowed to move it backwards is a revocation, which
 * is a refund and must take effect immediately.
 */

/** The fields of Apple's decoded payload this decision actually uses. */
export type AppleTransaction = {
  productId: string;
  originalTransactionId: string;
  /** Milliseconds since the epoch, as Apple sends them. Absent for non-subscriptions. */
  expiresDate?: number;
  /** Set when the purchase was refunded or the family sharing revoked. */
  revocationDate?: number;
};

/** Which product ids this app sells, and nothing else. */
export type ProductCatalog = {
  monthly: string;
  yearly: string;
};

export type CurrentEntitlement = {
  kind: 'trial' | 'paid' | 'comped';
  expiresAt: Date | null;
};

export type Decision =
  | { action: 'set'; kind: 'paid'; expiresAt: Date; reason: 'purchase' | 'renewal' }
  | { action: 'revoke'; expiresAt: Date }
  | { action: 'ignore'; reason: IgnoreReason };

export type IgnoreReason =
  | 'unknown_product'
  | 'no_expiry'
  | 'already_further_ahead'
  | 'comped_forever';

/**
 * @param current what the account has now, or null if it somehow has no row.
 * @param now injected, because "has this expired" is a question about a clock
 *   and a function that reads one cannot be tested at the boundary.
 */
export function decideFromTransaction(
  transaction: AppleTransaction,
  catalog: ProductCatalog,
  current: CurrentEntitlement | null,
  now: Date,
): Decision {
  /**
   * A product this app does not sell buys nothing.
   *
   * The verification upstream proves Apple signed it and that it is for this
   * bundle; it does not prove it is for a thing we offer. A product id that
   * was renamed in App Store Connect, or a consumable added later for
   * something else, must not silently turn into trainer access.
   */
  if (transaction.productId !== catalog.monthly && transaction.productId !== catalog.yearly) {
    return { action: 'ignore', reason: 'unknown_product' };
  }

  /**
   * An account comped for ever is outside the App Store's reach entirely.
   *
   * That is an operator's decision, and nothing Apple sends may undo it: not a
   * purchase, which would turn "for ever" into "until the 14th of next month";
   * not an expiry; and not a refund either. A refund gives back money for
   * something this account never needed to buy — the access was not bought,
   * so there is nothing for the refund to take away.
   *
   * Checked before revocation on purpose. The people comped for ever include
   * the ones who test the paywall in TestFlight, where sandbox purchases are
   * bought, expired and refunded as a matter of routine, and every one of
   * those arrives here looking like the real thing. Only an operator ends a
   * comp, from the admin panel, where it is recorded.
   */
  if (current?.kind === 'comped' && current.expiresAt === null) {
    return { action: 'ignore', reason: 'comped_forever' };
  }

  /**
   * Otherwise revocation wins. Money has been given back, and access that was
   * paid for ends with it, immediately rather than at the old expiry.
   */
  if (transaction.revocationDate != null) {
    return { action: 'revoke', expiresAt: new Date(transaction.revocationDate) };
  }

  // A subscription without an expiry is not a subscription. Rather than invent
  // a duration, do nothing and leave whatever they had.
  if (transaction.expiresDate == null) {
    return { action: 'ignore', reason: 'no_expiry' };
  }

  const expiresAt = new Date(transaction.expiresDate);

  /**
   * Never backwards. A retried notification for an older renewal must not
   * shorten an entitlement a newer one already extended.
   */
  if (current?.expiresAt != null && current.expiresAt >= expiresAt) {
    return { action: 'ignore', reason: 'already_further_ahead' };
  }

  // A renewal is simply a purchase against a subscription that was already
  // running. The distinction is for the log, not for the row.
  const running = current?.expiresAt != null && current.expiresAt > now;

  return { action: 'set', kind: 'paid', expiresAt, reason: running ? 'renewal' : 'purchase' };
}
