import { describe, expect, it } from 'vitest';
import {
  type AppleTransaction,
  type CurrentEntitlement,
  type ProductCatalog,
  decideFromTransaction,
} from '../appleSubscription';

const catalog: ProductCatalog = { monthly: 'lockin.monthly', yearly: 'lockin.yearly' };
const now = new Date('2026-09-15T12:00:00Z');
const day = 86_400_000;

const tx = (overrides: Partial<AppleTransaction> = {}): AppleTransaction => ({
  productId: catalog.monthly,
  originalTransactionId: '2000000000000001',
  expiresDate: now.getTime() + 30 * day,
  ...overrides,
});

const trial: CurrentEntitlement = { kind: 'trial', expiresAt: new Date(now.getTime() + 10 * day) };
const compedForever: CurrentEntitlement = { kind: 'comped', expiresAt: null };

describe('decideFromTransaction', () => {
  it('turns a purchase into paid access until Apple says it ends', () => {
    const decision = decideFromTransaction(tx(), catalog, { kind: 'trial', expiresAt: null }, now);
    // A trial with no expiry cannot exist (the table forbids it), but "no
    // running subscription" is the case being named here, so use an ended one.
    const ended = decideFromTransaction(
      tx(),
      catalog,
      { kind: 'trial', expiresAt: new Date(now.getTime() - day) },
      now,
    );

    expect(decision.action).toBe('set');
    expect(ended).toEqual({
      action: 'set',
      kind: 'paid',
      expiresAt: new Date(now.getTime() + 30 * day),
      reason: 'purchase',
    });
  });

  it('calls it a renewal when access was still running', () => {
    const decision = decideFromTransaction(tx(), catalog, trial, now);
    expect(decision).toMatchObject({ action: 'set', reason: 'renewal' });
  });

  it('handles an account that somehow has no row', () => {
    expect(decideFromTransaction(tx(), catalog, null, now)).toMatchObject({
      action: 'set',
      reason: 'purchase',
    });
  });

  it('accepts the yearly product as well as the monthly one', () => {
    const decision = decideFromTransaction(tx({ productId: catalog.yearly }), catalog, null, now);
    expect(decision.action).toBe('set');
  });

  it('ignores a product this app does not sell', () => {
    expect(decideFromTransaction(tx({ productId: 'something.else' }), catalog, null, now)).toEqual({
      action: 'ignore',
      reason: 'unknown_product',
    });
  });

  it('does not let a retried older renewal shorten access', () => {
    const current: CurrentEntitlement = { kind: 'paid', expiresAt: new Date(now.getTime() + 60 * day) };
    expect(decideFromTransaction(tx(), catalog, current, now)).toEqual({
      action: 'ignore',
      reason: 'already_further_ahead',
    });
  });

  it('ends paid access immediately on a refund', () => {
    const current: CurrentEntitlement = { kind: 'paid', expiresAt: new Date(now.getTime() + 20 * day) };
    const revokedAt = now.getTime() - 60_000;

    expect(decideFromTransaction(tx({ revocationDate: revokedAt }), catalog, current, now)).toEqual({
      action: 'revoke',
      expiresAt: new Date(revokedAt),
    });
  });

  it('ignores a subscription that carries no expiry', () => {
    expect(decideFromTransaction(tx({ expiresDate: undefined }), catalog, trial, now)).toEqual({
      action: 'ignore',
      reason: 'no_expiry',
    });
  });

  describe('an account comped for ever', () => {
    it('is not shortened by a purchase', () => {
      expect(decideFromTransaction(tx(), catalog, compedForever, now)).toEqual({
        action: 'ignore',
        reason: 'comped_forever',
      });
    });

    /**
     * The guarantee that matters most, and the one the first draft got wrong:
     * it let a refund revoke a comp. Sandbox purchases in TestFlight are bought
     * and refunded as routine, by exactly the people who are comped.
     */
    it('is not revoked by a refund', () => {
      const decision = decideFromTransaction(
        tx({ revocationDate: now.getTime() - 60_000 }),
        catalog,
        compedForever,
        now,
      );
      expect(decision).toEqual({ action: 'ignore', reason: 'comped_forever' });
    });

    it('is not touched by a transaction without an expiry either', () => {
      expect(decideFromTransaction(tx({ expiresDate: undefined }), catalog, compedForever, now)).toEqual({
        action: 'ignore',
        reason: 'comped_forever',
      });
    });
  });

  it('treats a comp with an end date like any other access that can be extended', () => {
    const shortComp: CurrentEntitlement = { kind: 'comped', expiresAt: new Date(now.getTime() + 5 * day) };
    expect(decideFromTransaction(tx(), catalog, shortComp, now)).toMatchObject({
      action: 'set',
      kind: 'paid',
      reason: 'renewal',
    });
  });
});
