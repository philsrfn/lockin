/**
 * The half of the limiter that has to survive a second process.
 *
 * The in-memory tests next door prove the arithmetic against a Map. These
 * prove the two things a Map cannot give: the counter is in the database,
 * where every process can see it, and it stays correct when nobody is taking
 * turns. That is why migration 032 exists — with a Map, forty model calls an
 * hour quietly becomes eighty the day a second worker starts, and nothing
 * anywhere says so.
 *
 * `rate_limits` carries no user_id, so `resetData()` does not truncate it.
 * Every test keys off its own name instead, which is closer to production
 * anyway: the rows outlive the request that made them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../db';
import { type Limit, sweepSharedBuckets, takeShared } from '../rateLimit';

const LIMIT: Limit = { max: 3, windowMs: 60_000 };

const keys: string[] = [];
const keyFor = (name: string): string => {
  const key = `test:${name}:${Math.random().toString(36).slice(2)}`;
  keys.push(key);
  return key;
};

afterEach(async () => {
  if (keys.length === 0) return;
  await pool.query('delete from rate_limits where key = any($1::text[])', [keys.splice(0)]);
});

describe('takeShared', () => {
  it('allows up to the limit and refuses the one after', async () => {
    const key = keyFor('ceiling');

    expect((await takeShared(key, LIMIT)).ok).toBe(true);
    expect((await takeShared(key, LIMIT)).ok).toBe(true);
    expect((await takeShared(key, LIMIT)).ok).toBe(true);

    const refused = await takeShared(key, LIMIT);
    expect(refused.ok).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts down what is left', async () => {
    const key = keyFor('remaining');

    expect((await takeShared(key, LIMIT)).remaining).toBe(2);
    expect((await takeShared(key, LIMIT)).remaining).toBe(1);
    expect((await takeShared(key, LIMIT)).remaining).toBe(0);
  });

  it('keys are independent, so one athlete cannot spend another\'s', async () => {
    const mine = keyFor('mine');
    const theirs = keyFor('theirs');

    for (let i = 0; i < 3; i += 1) await takeShared(mine, LIMIT);

    expect((await takeShared(mine, LIMIT)).ok).toBe(false);
    expect((await takeShared(theirs, LIMIT)).ok).toBe(true);
  });

  /**
   * Concurrent calls are what a second worker looks like from the database's
   * side: nobody waits for anybody, and the counter still has to come out
   * right. Exactly three are allowed, whatever order they land in.
   *
   * This is the test that earns the single-statement upsert. Written the
   * obvious way — select the row, decide, write it back — all six read a count
   * of nothing before any of them writes, and all six are allowed. Confirmed
   * by writing it that way on purpose and watching this fail; the other six
   * tests here passed throughout, which is what makes this the one that
   * matters.
   */
  it('counts concurrent callers into one bucket, whoever gets there first', async () => {
    const key = keyFor('two-workers');

    const verdicts = await Promise.all(
      Array.from({ length: 6 }, async () => takeShared(key, LIMIT)),
    );

    expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(3);
    expect(verdicts.filter((verdict) => !verdict.ok)).toHaveLength(3);
  });

  it('opens a fresh window once the old one closes', async () => {
    const key = keyFor('window');
    const brief: Limit = { max: 1, windowMs: 1 };

    expect((await takeShared(key, brief)).ok).toBe(true);

    // Not a sleep: move the stored expiry into the past, which is the same
    // state the row would be in a moment later and does not cost the suite a
    // second of waiting.
    await pool.query("update rate_limits set reset_at = now() - interval '1 second' where key = $1", [
      key,
    ]);

    expect((await takeShared(key, brief)).ok).toBe(true);
  });

  it('being past the ceiling does not push the window further out', async () => {
    const key = keyFor('no-extension');

    for (let i = 0; i < 4; i += 1) await takeShared(key, LIMIT);
    const [first] = (await pool.query<{ reset_at: Date }>(
      'select reset_at from rate_limits where key = $1',
      [key],
    )).rows;

    await takeShared(key, LIMIT);
    const [second] = (await pool.query<{ reset_at: Date }>(
      'select reset_at from rate_limits where key = $1',
      [key],
    )).rows;

    expect(second!.reset_at.getTime()).toBe(first!.reset_at.getTime());
  });
});

describe('sweepSharedBuckets', () => {
  it('removes closed windows and leaves open ones alone', async () => {
    const closed = keyFor('closed');
    const open = keyFor('open');

    await takeShared(closed, LIMIT);
    await takeShared(open, LIMIT);
    await pool.query("update rate_limits set reset_at = now() - interval '1 second' where key = $1", [
      closed,
    ]);

    await sweepSharedBuckets();

    const { rows } = await pool.query<{ key: string }>(
      'select key from rate_limits where key = any($1::text[])',
      [[closed, open]],
    );
    expect(rows.map((row) => row.key)).toEqual([open]);
  });
});
