/**
 * Sign in with Apple, over HTTP.
 *
 * The verifier is attacked directly in src/auth/__tests__. What is tested here
 * is the door around it: that the nonce is single-use, that a returned token
 * actually works, that signing in twice is the same person rather than two,
 * and that signing out one device leaves the others alone.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import { buildServer } from '../../index';
import { forgetAppleKeys } from '../../auth/appleIdentity';
import { forgetNonces } from '../../auth/nonce';
import { resetBuckets } from '../../rateLimit';
import { TEST_BEARER_TOKEN } from '../../test/database';
import { resetData, resetProfile } from '../../test/helpers';
import { syncRootToken } from '../../services/users';

let app: FastifyInstance;

const AUDIENCE = 'de.dotspiro.lockin';
const apple = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

function appleToken(claims: Record<string, unknown>): string {
  const header = { alg: 'RS256', kid: 'apple-test-key' };
  const body = `${b64(header)}.${b64({
    iss: 'https://appleid.apple.com',
    aud: AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000) - 5,
    ...claims,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  signer.end();
  return `${body}.${signer.sign(apple.privateKey).toString('base64url')}`;
}

/**
 * Apple's key endpoint, stood in for. The verifier fetches over the network in
 * production; here it is answered from the keypair generated above.
 */
beforeAll(async () => {
  const jwk = apple.publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  const keys = { keys: [{ kid: 'apple-test-key', kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e }] };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(input).includes('appleid.apple.com')) {
      return new Response(JSON.stringify(keys), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

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
  forgetNonces();
  forgetAppleKeys();
});

async function nonce(): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/auth/apple/nonce' });
  return response.json().nonce as string;
}

async function signIn(sub: string, extra: Record<string, unknown> = {}) {
  const value = await nonce();
  return app.inject({
    method: 'POST',
    url: '/auth/apple',
    payload: {
      identityToken: appleToken({ sub, nonce: value, ...extra }),
      nonce: value,
      ...(extra.name ? { name: extra.name } : {}),
    },
  });
}

describe('signing in', () => {
  it('needs no token of its own — it is how you get one', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/apple/nonce' })).statusCode).toBe(200);
  });

  it('creates an athlete and hands back a working token', async () => {
    const response = await signIn('001.new.athlete', { email: 'sam@example.com', name: 'Sam' });

    expect(response.statusCode).toBe(200);
    const { token, isNew, onboarded } = response.json();
    expect(isNew).toBe(true);
    expect(onboarded).toBe(false);

    const profile = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile.name).toBe('Sam');
  });

  it('is the same person the second time, not a new one', async () => {
    const first = await signIn('001.returning');
    const second = await signIn('001.returning');

    expect(second.json().isNew).toBe(false);
    expect(second.json().user.id).toBe(first.json().user.id);
  });

  it('gives each device its own token, so signing in on one does not evict the other', async () => {
    const phone = (await signIn('001.two.devices')).json().token as string;
    const tablet = (await signIn('001.two.devices')).json().token as string;

    expect(phone).not.toBe(tablet);
    for (const token of [phone, tablet]) {
      const response = await app.inject({
        method: 'GET',
        url: '/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('keys on Apple\'s id, not on the email they may have hidden', async () => {
    // Apple sends the email only on the first authorisation, and it may be a
    // relay address that changes. Keying on it would hand somebody a fresh
    // account every time they signed in.
    const first = await signIn('001.no.email.later', { email: 'real@example.com' });
    const second = await signIn('001.no.email.later');

    expect(second.json().user.id).toBe(first.json().user.id);
  });

  it('starts them with their own everything', async () => {
    const token = (await signIn('001.fresh')).json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    const contexts = await app.inject({ method: 'GET', url: '/contexts', headers: auth });
    const rules = await app.inject({ method: 'GET', url: '/rules', headers: auth });

    expect(contexts.json().contexts.map((c: { name: string }) => c.name)).toEqual(['Home']);
    expect(rules.json().rules.length).toBeGreaterThan(0);
    // And none of Phil's.
    expect(rules.json().rules.some((r: { text: string }) => r.text.includes('Skyr'))).toBe(false);
  });
});

describe('what it refuses', () => {
  it('a nonce that was never issued', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { identityToken: appleToken({ sub: 'x', nonce: 'invented' }), nonce: 'invented-nonce-that-is-long-enough' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('the same nonce twice — a captured token is useless the second time', async () => {
    const value = await nonce();
    const token = appleToken({ sub: '001.replay', nonce: value });
    const payload = { identityToken: token, nonce: value };

    expect((await app.inject({ method: 'POST', url: '/auth/apple', payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/apple', payload })).statusCode).toBe(401);
  });

  it('a token minted for another app', async () => {
    const value = await nonce();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: {
        identityToken: appleToken({ sub: 'x', nonce: value, aud: 'com.someone.else' }),
        nonce: value,
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('a token whose nonce is not the one we issued', async () => {
    const value = await nonce();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/apple',
      payload: { identityToken: appleToken({ sub: 'x', nonce: 'a-different-one' }), nonce: value },
    });

    expect(response.statusCode).toBe(401);
  });

  it('somebody knocking on the door all afternoon', async () => {
    for (let i = 0; i < 20; i += 1) {
      await app.inject({ method: 'POST', url: '/auth/apple/nonce' });
    }

    const response = await app.inject({ method: 'POST', url: '/auth/apple/nonce' });
    expect(response.statusCode).toBe(429);
  });
});

describe('signing out', () => {
  it('ends that device and leaves the others alone', async () => {
    const phone = (await signIn('001.signout')).json().token as string;
    const tablet = (await signIn('001.signout')).json().token as string;

    await app.inject({
      method: 'POST',
      url: '/auth/signout',
      headers: { authorization: `Bearer ${phone}` },
    });

    const phoneAfter = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${phone}` },
    });
    const tabletAfter = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${tablet}` },
    });

    expect(phoneAfter.statusCode).toBe(401);
    expect(tabletAfter.statusCode).toBe(200);
  });
});

describe('deleting the account', () => {
  it('takes everything with it', async () => {
    const token = (await signIn('001.leaving')).json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    await app.inject({
      method: 'POST',
      url: '/bodyweight',
      headers: auth,
      payload: { weightKg: 82.4, measuredOn: '2026-09-01' },
    });

    const gone = await app.inject({ method: 'DELETE', url: '/account', headers: auth });
    expect(gone.statusCode).toBe(200);

    // The token no longer resolves to anybody, and neither does the weigh-in.
    expect((await app.inject({ method: 'GET', url: '/profile', headers: auth })).statusCode).toBe(
      401,
    );
    const { rows } = await pool.query(
      "select count(*)::int as n from bodyweight where measured_on = '2026-09-01'",
    );
    expect(rows[0].n).toBe(0);
  });

  it('refuses on an account the operator provisioned', async () => {
    // Phil's token is not his to delete from inside the app — one tap would
    // take a year of training with it.
    const response = await app.inject({
      method: 'DELETE',
      url: '/account',
      headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
    });

    expect(response.statusCode).toBe(400);
    const { rows } = await pool.query('select count(*)::int as n from users where id = 1');
    expect(rows[0].n).toBe(1);
  });

  it('says which kind of account this is', async () => {
    const token = (await signIn('001.kind')).json().token as string;

    const mine = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { authorization: `Bearer ${token}` },
    });
    const phils = await app.inject({
      method: 'GET',
      url: '/account',
      headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
    });

    expect(mine.json().kind).toBe('apple');
    expect(phils.json().kind).toBe('root');
  });
});

describe('the token Phil already has', () => {
  it('still works, untouched by any of this', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${TEST_BEARER_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.name).toBe('Phil');
    await pool.query('select 1');
  });
});
