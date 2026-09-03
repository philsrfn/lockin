/**
 * Sign in with Apple, from the app's side.
 *
 * Three round trips and no password: ask the server for a nonce, hand that
 * nonce to Apple, post what Apple signed back to the server. The token that
 * comes back is the same kind of bearer token the app has always used, so
 * nothing downstream of here knows how it was obtained.
 *
 * The nonce is what stops a token lifted from one exchange being replayed
 * into another. It has to come from the server — a nonce the app invents
 * proves nothing to the server that receives it.
 */
import Constants, { AppOwnership } from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { ApiError } from '../api/client';
import { currentBaseUrl, saveConfig } from '../api/config';
import { systemLocale } from '../lib/locale';

export type SignInResult = {
  token: string;
  isNew: boolean;
  onboarded: boolean;
};

/**
 * iOS 13+, and not Expo Go, which ships the JavaScript for this module but not
 * its native view — rendering Apple's button there puts a red "Unimplemented
 * component" slab where the button should be. `isAvailableAsync` already says
 * no there, but this does not depend on it continuing to.
 *
 * Also false on a simulator with no Apple ID signed in.
 */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (Constants.appOwnership === AppOwnership.Expo) return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Thrown when the athlete backed out of Apple's sheet. Not an error to show. */
export class SignInCancelled extends Error {}

/**
 * `baseUrl` is passed in rather than read from config because at this point
 * there may be nothing stored yet — this call is what stores it.
 */
export async function signInWithApple(baseUrl: string): Promise<SignInResult> {
  const host = baseUrl.trim().replace(/\/+$/, '') || currentBaseUrl();

  const nonce = await requestNonce(host);

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // Apple copies this into the identity token verbatim. The server checks
      // it against the one it issued, and burns it.
      nonce,
    });
  } catch (caught) {
    if ((caught as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
      throw new SignInCancelled('Cancelled');
    }
    throw caught;
  }

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const result = await post<SignInResult>(host, '/auth/apple', {
    identityToken: credential.identityToken,
    nonce,
    // Only ever present on the first authorisation, and only to this app.
    // Afterwards Apple sends nulls, which is why the server stores it the
    // first time rather than expecting it again.
    name: joinName(credential.fullName),
    timezone: timeZone(),
    locale: systemLocale(),
    device: Platform.OS === 'ios' ? 'iPhone' : Platform.OS,
  });

  await saveConfig(host, result.token);
  return result;
}

async function requestNonce(host: string): Promise<string> {
  const { nonce } = await post<{ nonce: string }>(host, '/auth/apple/nonce', {});
  return nonce;
}

/**
 * Its own fetch rather than api/client, because both of these run before there
 * is a token or a stored base URL for that client to use.
 */
async function post<T>(host: string, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(0, (error as Error).name === 'AbortError' ? 'Request timed out' : 'Offline');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : `Sign-in failed (${response.status})`,
    );
  }

  return payload as T;
}

function joinName(name: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  if (!name) return null;
  const joined = [name.givenName, name.familyName].filter(Boolean).join(' ').trim();
  return joined || null;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
