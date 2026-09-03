/**
 * The admin panel, over HTTP.
 *
 * Two things matter here and the rest is arithmetic: that nobody who is not an
 * admin can see any of it, and that the money is right.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import { buildServer } from '../../index';
import { resetBuckets } from '../../rateLimit';
import { TEST_BEARER_TOKEN } from '../../test/database';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { recordUsage } from '../../services/usage';
import { issueToken, syncRootToken } from '../../services/users';
import { forgetPairings } from '../../admin/pairing';

let app: FastifyInstance;

const admin = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

beforeAll(async () => {
  await syncRootToken(TEST_BEARER_TOKEN);
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetData();
  await resetProfile();
  resetBuckets();
  forgetPairings();
});

const data = async (headers = admin) =>
  app.inject({ method: 'GET', url: '/admin/data', headers });

describe('who can see it', () => {
  it('serves the page to anybody, because the page holds nothing', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    // A shell: no athlete, no number, no token.
    expect(response.body).not.toContain('Phil');
    expect(response.body).not.toContain(TEST_BEARER_TOKEN);
  });

  it('gives the data to an admin', async () => {
    expect((await data()).statusCode).toBe(200);
  });

  it('answers 404 to an athlete who is not one', async () => {
    // Not 403: there is no reason to confirm to a signed-in stranger that a
    // panel exists at all.
    const other = await anotherAthlete();
    const token = await issueToken(other.userId, { source: 'apple' });

    const response = await data({ authorization: `Bearer ${token}` });

    expect(response.statusCode).toBe(404);
  });

  it('refuses every write to the same athlete', async () => {
    const other = await anotherAthlete();
    const token = await issueToken(other.userId, { source: 'apple' });
    const headers = { authorization: `Bearer ${token}` };

    for (const url of [`/admin/users/1/approval`, `/admin/users/1/budget`]) {
      const response = await app.inject({ method: 'POST', url, headers, payload: {} });
      expect(response.statusCode).toBe(404);
    }
  });

  it('refuses without a token at all', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/data' })).statusCode).toBe(401);
  });
});

describe('what it reports', () => {
  it('lists every athlete, with the one waiting flagged', async () => {
    const other = await anotherAthlete();
    await pool.query('update users set approved_at = null where id = $1', [other.userId]);

    const body = (await data()).json();

    expect(body.athletes).toHaveLength(2);
    expect(body.overview.athletes).toBe(2);
    expect(body.overview.pending).toBe(1);
    expect(body.athletes.find((row: { id: number }) => row.id === other.userId).approvedAt).toBe(
      null,
    );
  });

  it('prices spend from the tokens actually recorded', async () => {
    // 1M prompt tokens at $0.30 and 100k output at $2.50 = $0.55.
    await recordUsage(phil, 'chat', {
      promptTokens: 1_000_000,
      outputTokens: 100_000,
      totalTokens: 1_100_000,
    }, 'gemini-3.6-flash');

    const body = (await data()).json();
    const me = body.athletes.find((row: { id: number }) => row.id === 1);

    expect(me.usd30).toBeCloseTo(0.55, 4);
    expect(me.tokens30).toBe(1_100_000);
    expect(me.calls30).toBe(1);
    expect(body.overview.usdToday).toBeCloseTo(0.55, 4);
  });

  it('keeps one athlete\'s spend off another\'s row', async () => {
    const other = await anotherAthlete();
    await recordUsage(other, 'chat', {
      promptTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
    }, 'gemini-3.6-flash');

    const body = (await data()).json();
    const mine = body.athletes.find((row: { id: number }) => row.id === 1);
    const theirs = body.athletes.find((row: { id: number }) => row.id === other.userId);

    expect(mine.usd30).toBe(0);
    expect(theirs.usd30).toBeCloseTo(0.3, 4);
  });

  it('reports an unpriced model rather than counting it as free', async () => {
    // The failure that matters: a dashboard reading $0.00 looks identical to
    // not having spent anything.
    await recordUsage(phil, 'chat', {
      promptTokens: 5000,
      outputTokens: 500,
      totalTokens: 5500,
    }, 'some-model-nobody-priced');

    const body = (await data()).json();

    expect(body.overview.usd30).toBe(0);
    expect(body.overview.unpricedTokens).toBe(5500);
  });

  it('breaks the spend down by what it was for', async () => {
    const call = { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 };
    await recordUsage(phil, 'chat', call, 'gemini-3.6-flash');
    await recordUsage(phil, 'chat', call, 'gemini-3.6-flash');
    await recordUsage(phil, 'weekly_review', call, 'gemini-2.5-pro');

    const body = (await data()).json();
    const purposes = Object.fromEntries(
      body.spendByPurpose.map((row: { purpose: string; calls: number }) => [
        row.purpose,
        row.calls,
      ]),
    );

    expect(purposes).toEqual({ chat: 2, weekly_review: 1 });
    // Pro is dearer, so it sorts above two Flash calls of the same size.
    expect(body.spendByPurpose[0].purpose).toBe('weekly_review');
  });

  it('returns a full month of days, including the empty ones', async () => {
    const body = (await data()).json();

    expect(body.spendByDay).toHaveLength(30);
    expect(body.spendByDay.every((day: { usd: number }) => day.usd === 0)).toBe(true);
    expect(body.spendByDay[29].day).toBe(new Date().toISOString().slice(0, 10));
  });

  it('counts a week of activity per athlete', async () => {
    await app.inject({
      method: 'POST',
      url: '/bodyweight',
      headers: admin,
      payload: { weightKg: 95.5 },
    });

    const body = (await data()).json();

    expect(body.athletes.find((row: { id: number }) => row.id === 1).weighIns7).toBe(1);
  });

  it('says which rates produced the totals', async () => {
    // A wrong rate should be visible on the page, not silently applied.
    const body = (await data()).json();

    expect(body.overview.rates['gemini-3.6-flash']).toEqual({ input: 0.3, output: 2.5 });
  });
});

describe('letting people in and out', () => {
  it('approves a pending athlete', async () => {
    const other = await anotherAthlete();
    await pool.query('update users set approved_at = null where id = $1', [other.userId]);

    const response = await app.inject({
      method: 'POST',
      url: `/admin/users/${other.userId}/approval`,
      headers: admin,
      payload: { approved: true },
    });

    expect(response.statusCode).toBe(200);
    const row = response
      .json()
      .athletes.find((entry: { id: number }) => entry.id === other.userId);
    expect(row.approvedAt).not.toBe(null);
  });

  it('signs out every device when it revokes', async () => {
    // A flag they can ignore is not a revocation. The phone in their pocket
    // has to stop working.
    const other = await anotherAthlete();
    const token = await issueToken(other.userId, { source: 'apple' });
    const headers = { authorization: `Bearer ${token}` };

    expect((await app.inject({ method: 'GET', url: '/profile', headers })).statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: `/admin/users/${other.userId}/approval`,
      headers: admin,
      payload: { approved: false },
    });

    expect((await app.inject({ method: 'GET', url: '/profile', headers })).statusCode).toBe(401);
  });

  it('keeps their data when it revokes', async () => {
    const other = await anotherAthlete();
    await pool.query(
      "insert into bodyweight (user_id, measured_on, weight_kg) values ($1, '2026-09-01', 80)",
      [other.userId],
    );

    await app.inject({
      method: 'POST',
      url: `/admin/users/${other.userId}/approval`,
      headers: admin,
      payload: { approved: false },
    });

    const { rows } = await pool.query('select count(*)::int as n from bodyweight where user_id = $1', [
      other.userId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('refuses to let an admin revoke themselves', async () => {
    // There is no way back into the panel that grants access.
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users/1/approval',
      headers: admin,
      payload: { approved: false },
    });

    expect(response.statusCode).toBe(400);
    expect((await data()).statusCode).toBe(200);
  });

  it('records what was done, and by whom', async () => {
    const other = await anotherAthlete();

    await app.inject({
      method: 'POST',
      url: `/admin/users/${other.userId}/approval`,
      headers: admin,
      payload: { approved: false },
    });

    const body = (await data()).json();

    expect(body.actions[0]).toMatchObject({ actor: 'Phil', action: 'revoke' });
  });
});

describe('the daily cap', () => {
  it('sets one, and reports it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users/1/budget',
      headers: admin,
      payload: { budget: 50_000 },
    });

    expect(response.statusCode).toBe(200);
    const body = (await data()).json();
    expect(body.athletes.find((row: { id: number }) => row.id === 1).dailyTokenBudget).toBe(50_000);
  });

  it('takes 0 as no ceiling, and refuses nonsense', async () => {
    const zero = await app.inject({
      method: 'POST',
      url: '/admin/users/1/budget',
      headers: admin,
      payload: { budget: 0 },
    });
    const negative = await app.inject({
      method: 'POST',
      url: '/admin/users/1/budget',
      headers: admin,
      payload: { budget: -1 },
    });

    expect(zero.statusCode).toBe(200);
    expect(negative.statusCode).toBe(400);
  });
});


describe('letting a browser in from the phone', () => {
  const startPair = () => app.inject({ method: 'POST', url: '/admin/pair' });
  const collect = (id: string) =>
    app.inject({ method: 'GET', url: `/admin/pair/${encodeURIComponent(id)}` });

  it('starts without a token, because the browser has none', async () => {
    const response = await startPair();

    expect(response.statusCode).toBe(200);
    expect(response.json().code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('gives the browser nothing until the phone claims it', async () => {
    const { id } = (await startPair()).json();

    expect((await collect(id)).json()).toEqual({ pending: true });
  });

  it('hands over a working token once an admin claims the code', async () => {
    const { id, code } = (await startPair()).json();

    const claimed = await app.inject({
      method: 'POST',
      url: '/admin/pair/claim',
      headers: admin,
      payload: { code },
    });
    expect(claimed.json()).toEqual({ claimed: true });

    const { token } = (await collect(id)).json();
    expect(token).toBeTruthy();

    // And it is an admin token, not merely a session.
    const response = await data({ authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
  });

  it('refuses to be claimed by somebody who is not an admin', async () => {
    // The whole scheme rests on this: the code is shown on a public screen, so
    // it must be worthless to anybody who cannot already see the panel.
    const other = await anotherAthlete();
    const otherToken = await issueToken(other.userId, { source: 'apple' });
    const { id, code } = (await startPair()).json();

    const claimed = await app.inject({
      method: 'POST',
      url: '/admin/pair/claim',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { code },
    });

    expect(claimed.statusCode).toBe(404);
    expect((await collect(id)).json()).toEqual({ pending: true });
  });

  it('refuses to be claimed with no token at all', async () => {
    const { code } = (await startPair()).json();

    const claimed = await app.inject({
      method: 'POST',
      url: '/admin/pair/claim',
      payload: { code },
    });

    expect(claimed.statusCode).toBe(401);
  });

  it('is collected once, so a leaked id is worth one attempt', async () => {
    const { id, code } = (await startPair()).json();
    await app.inject({ method: 'POST', url: '/admin/pair/claim', headers: admin, payload: { code } });

    expect((await collect(id)).statusCode).toBe(200);
    expect((await collect(id)).statusCode).toBe(404);
  });

  it('does not accept an id nobody issued', async () => {
    expect((await collect('a'.repeat(43))).statusCode).toBe(404);
  });

  it('gives the browser its own device row', async () => {
    // So signing the laptop out does not sign the phone out with it.
    const { id, code } = (await startPair()).json();
    await app.inject({ method: 'POST', url: '/admin/pair/claim', headers: admin, payload: { code } });
    const { token } = (await collect(id)).json();

    const { rows } = await pool.query(
      "select device from sessions_tokens where user_id = 1 and device = 'Admin panel'",
    );
    expect(rows).toHaveLength(1);

    // Signing the browser out leaves the root token alone.
    await app.inject({
      method: 'POST',
      url: '/auth/signout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await data()).statusCode).toBe(200);
  });

  it('stops issuing codes to somebody hammering the door', async () => {
    for (let i = 0; i < 20; i += 1) await startPair();

    expect((await startPair()).statusCode).toBe(429);
  });
});
