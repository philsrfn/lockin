/**
 * Whether somebody may use the trainer.
 *
 * Not whether they may use the app. Those are different questions and the
 * difference is the whole design: an athlete whose subscription lapsed keeps
 * every set they logged, keeps logging, keeps their history, keeps their
 * export and keeps the delete button. What they lose is the coach — the part
 * that costs money to run and is the reason to pay for it.
 *
 * Holding somebody's training history hostage to get them to renew would be a
 * good way to make them renew once and never trust the app again. It is also
 * the sort of thing the GDPR takes a dim view of.
 */

export type EntitlementKind = 'trial' | 'paid' | 'comped';

export type Entitlement = {
  kind: EntitlementKind;
  /** Null only for `comped`, which is the one kind allowed to be forever. */
  expiresAt: Date | null;
};

export type Access = {
  /** The trainer, the coach note, the weekly review, estimating food. */
  coach: boolean;
  /** Logging, reading, exporting, deleting. Always true, and that is the point. */
  ownData: true;
  /** Days left, when that is a meaningful thing to say. */
  daysLeft: number | null;
  kind: EntitlementKind | 'none';
};

const DAY_MS = 86_400_000;

/**
 * An account with no row at all has no access to the coach.
 *
 * Fail closed, like everything else that decides what somebody may reach — and
 * unreachable in practice, because migration 031 gave every existing account a
 * row and signup creates one. A missing row means something went wrong, and
 * the honest response to that is not to hand out the expensive part.
 */
export function accessFor(entitlement: Entitlement | null, now: Date = new Date()): Access {
  if (!entitlement) return { coach: false, ownData: true, daysLeft: null, kind: 'none' };

  const { kind, expiresAt } = entitlement;
  if (expiresAt == null) return { coach: true, ownData: true, daysLeft: null, kind };

  const remaining = expiresAt.getTime() - now.getTime();
  return {
    coach: remaining > 0,
    ownData: true,
    // Rounded up, because somebody with four hours left has a day left as far
    // as any sentence about it is concerned.
    daysLeft: Math.max(0, Math.ceil(remaining / DAY_MS)),
    kind,
  };
}

/** When a trial granted now runs out. */
export const trialExpiry = (days: number, now: Date = new Date()): Date =>
  new Date(now.getTime() + Math.max(0, days) * DAY_MS);
