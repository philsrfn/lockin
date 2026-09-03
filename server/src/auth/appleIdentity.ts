/**
 * Verifying an Apple identity token.
 *
 * This is the one place in the app where a stranger's input decides who they
 * are, so it is written to be read rather than to be short. Everything Apple
 * signs is checked: the signature against Apple's published keys, the issuer,
 * the audience — which is what stops a token minted for somebody else's app
 * being replayed at ours — the expiry, and the nonce we issued.
 *
 * No JWT library. Node verifies RS256 and imports a JWK directly, and a
 * dependency here would be one more thing between us and something that must
 * be obviously correct.
 */
import { createHash, createPublicKey, createVerify, timingSafeEqual } from 'node:crypto';
import { unauthorized } from '../errors';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';

/** Apple rotates these. Cached because a sign-in should not wait on a fetch. */
const KEY_CACHE_MS = 60 * 60_000;

/** Apple's tokens live about ten minutes; this is slack for clock drift. */
const CLOCK_SKEW_SECONDS = 300;

export type AppleIdentity = {
  /** Apple's stable id for this person in this app. The only durable key. */
  sub: string;
  /** Absent unless they shared it, and possibly a private relay address. */
  email: string | null;
  emailVerified: boolean;
};

type Jwk = { kid: string; kty: string; alg: string; n: string; e: string };

export type KeyFetcher = () => Promise<Jwk[]>;

let cached: { keys: Jwk[]; fetchedAt: number } | null = null;

async function fetchAppleKeys(): Promise<Jwk[]> {
  const response = await fetch(APPLE_KEYS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Apple key fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) throw new Error('Apple returned no keys');
  return body.keys;
}

async function appleKeys(fetcher: KeyFetcher, now: number): Promise<Jwk[]> {
  if (cached && now - cached.fetchedAt < KEY_CACHE_MS) return cached.keys;
  const keys = await fetcher();
  cached = { keys, fetchedAt: now };
  return keys;
}

/** Between tests, and whenever a key we expected turns out to be missing. */
export function forgetAppleKeys(): void {
  cached = null;
}

const base64UrlToBuffer = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function decodeSegment<T>(segment: string): T {
  return JSON.parse(base64UrlToBuffer(segment).toString('utf8')) as T;
}

/** Constant-time, and safe when the lengths differ. */
function sameString(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

type Header = { alg?: string; kid?: string };
type Claims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
};

export type VerifyOptions = {
  /** The iOS bundle identifier. A token for any other app is rejected. */
  audience: string;
  /** The nonce this server issued for this sign-in. */
  expectedNonce: string;
  now?: Date;
  fetchKeys?: KeyFetcher;
};

export async function verifyAppleIdentityToken(
  token: string,
  options: VerifyOptions,
): Promise<AppleIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('That is not an Apple identity token');

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: Header;
  let claims: Claims;
  try {
    header = decodeSegment<Header>(headerPart);
    claims = decodeSegment<Claims>(payloadPart);
  } catch {
    throw unauthorized('That Apple token could not be read');
  }

  // Only RS256. Accepting the algorithm the token names is how "alg: none"
  // and HMAC-with-the-public-key forgeries get in.
  if (header.alg !== 'RS256') throw unauthorized('Unexpected signing algorithm');
  if (!header.kid) throw unauthorized('That Apple token names no key');

  const now = options.now ?? new Date();
  const keys = await appleKeys(options.fetchKeys ?? fetchAppleKeys, now.getTime());
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    // Apple rotated since we cached. Next attempt refetches.
    forgetAppleKeys();
    throw unauthorized('That Apple token was signed with an unknown key');
  }

  const publicKey = createPublicKey({
    key: { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256' },
    format: 'jwk',
  });

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  if (!verifier.verify(publicKey, base64UrlToBuffer(signaturePart))) {
    throw unauthorized('That Apple token is not correctly signed');
  }

  if (claims.iss !== APPLE_ISSUER) throw unauthorized('That token did not come from Apple');

  // The audience is what binds the token to *this* app. Without it, a token
  // Apple issued to any other app would sign somebody in here.
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(options.audience)) {
    throw unauthorized('That Apple token was issued for another app');
  }

  const seconds = Math.floor(now.getTime() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < seconds) {
    throw unauthorized('That Apple token has expired — try signing in again');
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > seconds) {
    throw unauthorized('That Apple token is from the future');
  }

  if (!claims.nonce || !sameString(claims.nonce, options.expectedNonce)) {
    throw unauthorized('That sign-in could not be matched to this device');
  }

  if (!claims.sub) throw unauthorized('That Apple token identifies nobody');

  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    // Apple sends this as a string on some paths and a boolean on others.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
}
