import { beforeEach, describe, expect, it } from 'vitest';
import { consumeNonce, forgetNonces, issueNonce, outstandingNonces } from '../nonce';

beforeEach(forgetNonces);

describe('issueNonce', () => {
  it('never issues the same value twice', () => {
    const values = new Set(Array.from({ length: 200 }, () => issueNonce()));

    expect(values.size).toBe(200);
  });

  it('is long enough not to be guessed', () => {
    expect(issueNonce().length).toBeGreaterThanOrEqual(40);
  });
});

describe('consumeNonce', () => {
  it('accepts one this server issued', () => {
    expect(consumeNonce(issueNonce())).toBe(true);
  });

  it('accepts it exactly once — a captured token is useless twice', () => {
    const nonce = issueNonce();

    expect(consumeNonce(nonce)).toBe(true);
    expect(consumeNonce(nonce)).toBe(false);
  });

  it('refuses one nobody issued', () => {
    expect(consumeNonce('made-up')).toBe(false);
  });

  it('refuses one that has gone stale', () => {
    const now = Date.now();
    const nonce = issueNonce(now);

    expect(consumeNonce(nonce, now + 11 * 60_000)).toBe(false);
  });

  it('forgets a stale one rather than keeping it forever', () => {
    const now = Date.now();
    issueNonce(now);
    expect(outstandingNonces()).toBe(1);

    issueNonce(now + 11 * 60_000);

    expect(outstandingNonces()).toBe(1);
  });
});
