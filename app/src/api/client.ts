/**
 * The only thing the app talks to. The Gemini key never leaves the backend (§2).
 *
 * Phase 1 reads the bearer token from EXPO_PUBLIC_API_TOKEN, which bakes it
 * into the bundle. The spec wants it in the iOS keychain — that moves to
 * expo-secure-store with a paste-once setup screen before this goes to
 * TestFlight. An env var is the honest choice while it only runs on a
 * simulator and a dev phone.
 */

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? '';

/** Gym wifi either answers quickly or is not going to. */
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A 4xx will fail the same way forever; a 5xx or a dropped socket will not. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    // No response at all: offline, wrong host, or timed out. Status 0 marks it
    // as worth retrying, which is what the sync queue keys off.
    throw new ApiError(0, (error as Error).name === 'AbortError' ? 'Request timed out' : 'Offline');
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`,
      payload.details,
    );
  }

  return payload as T;
}

export const apiBaseUrl = BASE_URL;
