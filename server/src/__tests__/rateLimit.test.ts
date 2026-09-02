import { beforeEach, describe, expect, it } from 'vitest';
import { API_LIMIT, resetBuckets, sweepBuckets, take } from '../rateLimit';

beforeEach(resetBuckets);

const LIMIT = { max: 3, windowMs: 1000 };

describe('take', () => {
  it('allows up to the limit', () => {
    expect(take('a', LIMIT, 0).ok).toBe(true);
    expect(take('a', LIMIT, 0).ok).toBe(true);
    expect(take('a', LIMIT, 0).ok).toBe(true);
  });

  it('refuses the one after', () => {
    for (let i = 0; i < 3; i += 1) take('a', LIMIT, 0);

    const verdict = take('a', LIMIT, 0);
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(1);
  });

  it('counts down what is left', () => {
    expect(take('a', LIMIT, 0).remaining).toBe(2);
    expect(take('a', LIMIT, 0).remaining).toBe(1);
  });

  it('keys are independent, so one athlete cannot spend another\'s', () => {
    for (let i = 0; i < 3; i += 1) take('a', LIMIT, 0);

    expect(take('b', LIMIT, 0).ok).toBe(true);
  });

  it('opens a fresh window when the old one passes', () => {
    for (let i = 0; i < 3; i += 1) take('a', LIMIT, 0);
    expect(take('a', LIMIT, 0).ok).toBe(false);

    expect(take('a', LIMIT, 1001).ok).toBe(true);
  });

  it('is generous enough for a phone draining its sync queue', () => {
    // A queued workout can be dozens of ops in a few seconds. The limit must
    // not turn a basement gym into lost sets.
    expect(API_LIMIT.max).toBeGreaterThan(100);
  });
});

describe('sweepBuckets', () => {
  it('forgets windows that have passed', () => {
    take('a', LIMIT, 0);
    sweepBuckets(2000);

    // Swept, so this is a fresh window rather than a second request.
    expect(take('a', LIMIT, 2000).remaining).toBe(2);
  });

  it('leaves a live window alone', () => {
    take('a', LIMIT, 0);
    sweepBuckets(500);

    expect(take('a', LIMIT, 500).remaining).toBe(1);
  });
});
