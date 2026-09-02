/**
 * What the trainer costs.
 *
 * Token usage was computed on every call and thrown away. With one athlete and
 * a €10 cap on the Google account that was survivable; with a handful of
 * friends it is the one line item that scales with use and has no ceiling of
 * its own, and the failure mode is a bill rather than an error message.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { assertWithinBudget, recordUsage, usageToday } from '../usage';

let sam: Ctx;

const CALL = { promptTokens: 1200, outputTokens: 300, totalTokens: 1500 };

beforeEach(async () => {
  await resetData();
  await resetProfile();
  await pool.query('update profile set daily_token_budget = 300000 where user_id = 1');
  sam = await anotherAthlete();
});

describe('usageToday', () => {
  it('starts at nothing', async () => {
    const usage = await usageToday(phil);

    expect(usage).toMatchObject({ calls: 0, tokens: 0, budget: 300000 });
    expect(usage.remaining).toBe(300000);
  });

  it('adds up calls and tokens', async () => {
    await recordUsage(phil, 'chat', CALL);
    await recordUsage(phil, 'chat', CALL);
    await recordUsage(phil, 'coach_note', CALL);

    const usage = await usageToday(phil);

    expect(usage.calls).toBe(3);
    expect(usage.tokens).toBe(4500);
    expect(usage.remaining).toBe(300000 - 4500);
  });

  it('is per athlete', async () => {
    await recordUsage(phil, 'chat', CALL);

    expect((await usageToday(sam)).tokens).toBe(0);
  });
});

describe('assertWithinBudget', () => {
  it('lets a normal day through', async () => {
    await recordUsage(phil, 'chat', CALL);

    await expect(assertWithinBudget(phil)).resolves.toBeUndefined();
  });

  it('stops the day once the allowance is gone', async () => {
    await pool.query('update profile set daily_token_budget = 1000 where user_id = 1');
    await recordUsage(phil, 'chat', CALL);

    await expect(assertWithinBudget(phil)).rejects.toMatchObject({ statusCode: 429 });
  });

  it('says the rest of the app still works, because it does', async () => {
    await pool.query('update profile set daily_token_budget = 1000 where user_id = 1');
    await recordUsage(phil, 'chat', CALL);

    await expect(assertWithinBudget(phil)).rejects.toThrow(/logging.*keeps working/);
  });

  it('treats a budget of zero as no ceiling at all', async () => {
    // The escape hatch: Phil's own account, and anything running as a job.
    await pool.query('update profile set daily_token_budget = 0 where user_id = 1');
    await recordUsage(phil, 'chat', { promptTokens: 9_000_000, outputTokens: 0, totalTokens: 9_000_000 });

    await expect(assertWithinBudget(phil)).resolves.toBeUndefined();
  });

  it('does not spend one athlete\'s allowance on another', async () => {
    await pool.query('update profile set daily_token_budget = 1000');
    await recordUsage(phil, 'chat', CALL);

    await expect(assertWithinBudget(phil)).rejects.toThrow();
    await expect(assertWithinBudget(sam)).resolves.toBeUndefined();
  });
});
