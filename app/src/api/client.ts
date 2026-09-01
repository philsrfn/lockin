/**
 * The only thing the app talks to. The Gemini key never leaves the backend (§2),
 * and the bearer token lives in the iOS keychain — see api/config.ts.
 */
import { currentBaseUrl, currentToken } from './config';

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
    response = await fetch(`${currentBaseUrl()}${path}`, {
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
    throw new ApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`,
      payload.details,
    );
  }

  return payload as T;
}

export const apiBaseUrl = currentBaseUrl;
