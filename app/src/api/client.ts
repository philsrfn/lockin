/**
 * The only thing the app talks to. The Gemini key never leaves the backend (§2),
 * and the bearer token lives in the iOS keychain — see api/config.ts.
 */
import { currentToken, ensureBaseUrl } from './config';

/** Gym wifi either answers quickly or is not going to. */
const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    /**
     * A stable string from the server, when the status alone is not enough to
     * decide what the app should do. `pending_approval` is the one that
     * matters: a 403 the athlete cannot fix by signing in again.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** A 4xx will fail the same way forever; a 5xx or a dropped socket will not. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/**
 * Two answers the app has to act on wherever they arrive, rather than showing
 * as an error on one screen.
 *
 * `refused` is 403 pending_approval: an account that exists and has not been
 * let in. `expired` is 401: a token that no longer resolves, which is what a
 * revoked athlete's phone gets. Both are definitive — the same request will
 * fail the same way forever — so they change what the app shows rather than
 * being retried.
 */
const refusalListeners = new Set<(kind: 'refused' | 'expired') => void>();

export function onRefused(listener: (kind: 'refused' | 'expired') => void): () => void {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  /**
   * Never a relative URL. An empty base makes `${base}${path}` relative, and a
   * relative fetch is answered by whatever server the bundle came from — in
   * Expo Go that is Metro, which returns its own manifest with a cheerful 200.
   * `/today` resolved to an Expo manifest, was treated as a valid answer, and
   * was written to the offline cache; every screen that then read three levels
   * into it threw, with a stack pointing at the screen rather than at this
   * line.
   *
   * Reads the keychain when this module has not been initialised yet rather
   * than failing, so a hot reload does not leave the app hostless.
   */
  const base = await ensureBaseUrl();
  if (!base) throw new ApiError(0, 'No server configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${currentToken()}`,
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
    const error = new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`,
      payload.details,
      typeof payload.code === 'string' ? payload.code : undefined,
    );

    // Announced from here rather than handled per screen: whichever tab the
    // athlete happens to be on is the one that finds out.
    if (error.code === 'pending_approval') {
      for (const listener of refusalListeners) listener('refused');
    } else if (error.status === 401) {
      for (const listener of refusalListeners) listener('expired');
    }

    throw error;
  }

  return payload as T;
}


