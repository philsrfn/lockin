/**
 * Where the backend is, and the token to talk to it.
 *
 * §2 wants the token in the iOS keychain. EXPO_PUBLIC_* variables are inlined
 * into the JS bundle at build time, so shipping the token that way would put it
 * inside the .ipa — extractable by anyone who gets the file. Instead:
 *
 *   - production builds ship with no token, and ask for it once on first launch
 *   - the value lives in the keychain via expo-secure-store from then on
 *   - dev builds seed it from app/.env so the simulator needs no setup step
 *
 * The API URL is stored the same way, so pointing the app at a different
 * backend does not require a new TestFlight build.
 */
import * as SecureStore from 'expo-secure-store';
import { setPreferredLocale } from '../lib/locale';

const TOKEN_KEY = 'lockin.apiToken';
const URL_KEY = 'lockin.apiUrl';
/**
 * Remembered so the questionnaire is asked once and then never checked again.
 * Without it every cold start would wait on /profile before drawing anything,
 * which on gym wifi is several seconds of nothing.
 *
 * Cleared whenever a token is saved: the flag says "this athlete has answered
 * it", and a different token is a different athlete. Suffixed because the
 * first version of this key was not cleared that way, and a value written
 * under the old meaning would skip the questionnaire for somebody who has
 * never seen it.
 */
const ONBOARDED_KEY = 'lockin.onboarded.v2';
/** The athlete's language, mirrored from the profile so a cold start is
 *  already in it rather than flickering into it once /today answers. */
const LOCALE_KEY = 'lockin.locale';
/**
 * Whether the athlete has connected Apple Health. iOS never reports read
 * permission back — by design, so an app cannot infer what somebody declined —
 * so this records that they said yes to us, not that HealthKit said yes to
 * anything. An empty sync is the honest signal that nothing was shared.
 */
const HEALTH_KEY = 'lockin.health';

const BUILT_IN_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const BUILT_IN_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? '';

let token: string | null = null;
let baseUrl = '';

const normalise = (url: string) => url.trim().replace(/\/+$/, '');

/** Reads the keychain once at startup. Returns false when setup is needed. */
export async function loadConfig(): Promise<boolean> {
  setPreferredLocale(await SecureStore.getItemAsync(LOCALE_KEY));
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  baseUrl = (await SecureStore.getItemAsync(URL_KEY)) ?? '';

  // Development convenience only — in a production build these are empty.
  if (!token && BUILT_IN_TOKEN) {
    const seeded = BUILT_IN_TOKEN;
    token = seeded;
    await SecureStore.setItemAsync(TOKEN_KEY, seeded);
  }
  if (!baseUrl && BUILT_IN_URL) {
    baseUrl = normalise(BUILT_IN_URL);
    await SecureStore.setItemAsync(URL_KEY, baseUrl);
  }

  return Boolean(token && baseUrl);
}

export async function saveConfig(url: string, apiToken: string): Promise<void> {
  baseUrl = normalise(url);
  // A new token is a new athlete: whatever this device remembered about
  // onboarding — or about sharing their health data — belonged to the last one.
  await SecureStore.deleteItemAsync(ONBOARDED_KEY);
  await SecureStore.deleteItemAsync(HEALTH_KEY);
  token = apiToken.trim();
  await SecureStore.setItemAsync(URL_KEY, baseUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Signing out happens on the rules screen, four routes deep, and the thing that
 * has to react to it is the root layout. One listener rather than a state
 * library: there is exactly one event and exactly one subscriber.
 */
const signOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signOutListeners.add(listener);
  return () => signOutListeners.delete(listener);
}

export async function clearConfig(): Promise<void> {
  token = null;
  // The address is kept. It is not a credential, and forgetting it would make
  // the next person to sign in on this phone type a host name.
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  // Whatever this device remembered belonged to whoever just left.
  await SecureStore.deleteItemAsync(ONBOARDED_KEY);
  await SecureStore.deleteItemAsync(HEALTH_KEY);
  for (const listener of signOutListeners) listener();
}

/**
 * Remembers the athlete's language. Called whenever a profile arrives, which
 * is every time the Today screen loads — so a change made on another device
 * follows them here without a sign-out.
 */
export async function rememberLocale(locale: string | null): Promise<void> {
  setPreferredLocale(locale);
  if (locale) await SecureStore.setItemAsync(LOCALE_KEY, locale);
  else await SecureStore.deleteItemAsync(LOCALE_KEY);
}

export async function isHealthConnected(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HEALTH_KEY)) === 'yes';
}

export async function setHealthConnected(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(HEALTH_KEY, 'yes');
  else await SecureStore.deleteItemAsync(HEALTH_KEY);
}

export async function isOnboardedLocally(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ONBOARDED_KEY)) === 'yes';
}

export async function markOnboardedLocally(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, 'yes');
}

export const currentToken = () => token ?? '';
export const currentBaseUrl = () => baseUrl;
export const isConfigured = () => Boolean(token && baseUrl);
