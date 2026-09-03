/**
 * The one place a stranger's input decides who they are.
 *
 * Every test here is an attack: a token signed by the wrong key, minted for
 * another app, replayed after expiry, or with the algorithm swapped. A real
 * RSA keypair is generated per run and used as a stand-in for Apple's, so the
 * signature check is genuinely exercised rather than stubbed.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetAppleKeys, verifyAppleIdentityToken } from '../appleIdentity';

const AUDIENCE = 'de.dotspiro.lockin';
const NONCE = 'nonce-this-server-issued';
const NOW = new Date('2026-09-03T09:00:00Z');

const apple = generateKeyPairSync('rsa', { modulusLength: 2048 });
const impostor = generateKeyPairSync('rsa', { modulusLength: 2048 });

const jwkOf = (key: typeof apple.publicKey, kid: string) => {
  const jwk = key.export({ format: 'jwk' }) as { n: string; e: string };
  return { kid, kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e };
};

const APPLE_KEYS = [jwkOf(apple.publicKey, 'apple-key-1')];
const fetchKeys = async () => APPLE_KEYS;

const b64 = (value: object | string) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function sign(
  claims: Record<string, unknown>,
  options: { key?: typeof apple.privateKey; header?: Record<string, unknown> } = {},
): string {
  const header = { alg: 'RS256', kid: 'apple-key-1', ...options.header };
  const body = `${b64(header)}.${b64(claims)}`;

  if (header.alg === 'none') return `${body}.`;

  const signer = createSign('RSA-SHA256');
  signer.update(body);
  signer.end();
  return `${body}.${signer.sign(options.key ?? apple.privateKey).toString('base64url')}`;
}

const validClaims = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://appleid.apple.com',
  aud: AUDIENCE,
  sub: '001234.abcdef.0001',
  exp: Math.floor(NOW.getTime() / 1000) + 600,
  iat: Math.floor(NOW.getTime() / 1000) - 10,
  nonce: NONCE,
  email: 'phil@example.com',
  email_verified: 'true',
  ...overrides,
});

const verify = (token: string, overrides = {}) =>
  verifyAppleIdentityToken(token, {
    audience: AUDIENCE,
    expectedNonce: NONCE,
    now: NOW,
    fetchKeys,
    ...overrides,
  });

beforeEach(forgetAppleKeys);

describe('a token Apple really issued', () => {
  it('is accepted, and identifies the person', async () => {
    const identity = await verify(sign(validClaims()));

    expect(identity).toEqual({
      sub: '001234.abcdef.0001',
      email: 'phil@example.com',
      emailVerified: true,
    });
  });

  it('accepts an audience array, which Apple sometimes sends', async () => {
    const identity = await verify(sign(validClaims({ aud: [AUDIENCE] })));

    expect(identity.sub).toBe('001234.abcdef.0001');
  });

  it('accepts a boolean email_verified as well as a string', async () => {
    expect((await verify(sign(validClaims({ email_verified: true })))).emailVerified).toBe(true);
  });

  it('is fine with no email at all — Apple only sends it once', async () => {
    const identity = await verify(sign(validClaims({ email: undefined })));

    expect(identity.email).toBeNull();
  });
});

describe('what it refuses', () => {
  it('a token signed by somebody else', async () => {
    await expect(verify(sign(validClaims(), { key: impostor.privateKey }))).rejects.toThrow(
      'not correctly signed',
    );
  });

  it('a token with the signature stripped and the algorithm set to none', async () => {
    // The classic JWT forgery. Trusting the algorithm the token names is how
    // it works, so the algorithm is not negotiable here.
    await expect(verify(sign(validClaims(), { header: { alg: 'none' } }))).rejects.toThrow(
      'Unexpected signing algorithm',
    );
  });

  it('a token that swaps RSA for HMAC', async () => {
    await expect(verify(sign(validClaims(), { header: { alg: 'HS256' } }))).rejects.toThrow(
      'Unexpected signing algorithm',
    );
  });

  it('a token minted for another app', async () => {
    // Without this, any app Apple has ever signed a token for could sign
    // somebody in here.
    await expect(verify(sign(validClaims({ aud: 'com.someone.else' })))).rejects.toThrow(
      'issued for another app',
    );
  });

  it('a token from an issuer that is not Apple', async () => {
    await expect(verify(sign(validClaims({ iss: 'https://evil.example' })))).rejects.toThrow(
      'did not come from Apple',
    );
  });

  it('a token that has expired', async () => {
    const expired = validClaims({ exp: Math.floor(NOW.getTime() / 1000) - 3600 });

    await expect(verify(sign(expired))).rejects.toThrow('expired');
  });

  it('a token issued in the future', async () => {
    const ahead = validClaims({ iat: Math.floor(NOW.getTime() / 1000) + 3600 });

    await expect(verify(sign(ahead))).rejects.toThrow('from the future');
  });

  it('a token replayed with a nonce this server did not issue', async () => {
    await expect(verify(sign(validClaims({ nonce: 'somebody-elses' })))).rejects.toThrow(
      'could not be matched to this device',
    );
  });

  it('a token with no nonce at all', async () => {
    await expect(verify(sign(validClaims({ nonce: undefined })))).rejects.toThrow(
      'could not be matched to this device',
    );
  });

  it('a token signed with a key Apple does not publish', async () => {
    await expect(
      verify(sign(validClaims(), { header: { kid: 'unknown-key' } })),
    ).rejects.toThrow('unknown key');
  });

  it('a token that identifies nobody', async () => {
    await expect(verify(sign(validClaims({ sub: undefined })))).rejects.toThrow(
      'identifies nobody',
    );
  });

  it.each([
    ['something that is not a token', 'hello'],
    ['a token missing its signature', 'a.b'],
    ['an empty string', ''],
  ])('%s', async (_label, token) => {
    await expect(verify(token)).rejects.toThrow();
  });

  it('a token whose body is not JSON', async () => {
    await expect(verify(`${b64({ alg: 'RS256', kid: 'apple-key-1' })}.bm90LWpzb24.sig`)).rejects.toThrow(
      'could not be read',
    );
  });

  it('every refusal is a 401 rather than a crash', async () => {
    await expect(verify(sign(validClaims({ aud: 'com.someone.else' })))).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

describe('Apple rotating its keys', () => {
  it('forgets the cache when a key goes missing, so the next attempt refetches', async () => {
    let fetches = 0;
    const counting = async () => {
      fetches += 1;
      return APPLE_KEYS;
    };

    await verify(sign(validClaims()), { fetchKeys: counting });
    expect(fetches).toBe(1);

    // Cached: no second fetch.
    await verify(sign(validClaims()), { fetchKeys: counting });
    expect(fetches).toBe(1);

    // An unknown kid is answered from the warm cache — no fetch — and then
    // drops it, so the *next* sign-in is the one that asks Apple again. One
    // person hitting a rotated key cannot make everybody refetch.
    await expect(
      verify(sign(validClaims(), { header: { kid: 'rotated' } }), { fetchKeys: counting }),
    ).rejects.toThrow();
    expect(fetches).toBe(1);

    await verify(sign(validClaims()), { fetchKeys: counting });
    expect(fetches).toBe(2);
  });
});
