/**
 * What a failed request is, as a value.
 *
 * Split out of `client.ts` so reading an error does not mean importing the
 * transport — and through it the keychain, which only exists on a phone.
 * `lib/apiError.ts` turns one of these into words, and wants to be testable
 * without a simulator.
 */
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
