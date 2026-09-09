/** Errors services throw, mapped to status codes by the Fastify error handler. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    /**
     * A stable string the app can branch on, when the message alone is not
     * enough. Prose gets reworded and translated; this does not.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * The `code` is how an error reaches somebody in their own language.
 *
 * The message stays English and stays useful — it is what the logs keep, what
 * a developer reads, and what the app falls back to. But the athlete should
 * not be shown it: they chose German in the app and the server does not speak
 * it. So the errors a person can actually walk into carry a stable code, and
 * `app/src/lib/apiError.ts` looks that up in `locale.ts`, where every other
 * word in the interface already lives.
 *
 * Only those errors. The other eighty are reachable when the app has a bug —
 * "kcal must be a number" is not a sentence anybody should ever meet, and
 * translating it would imply otherwise.
 */
export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message: string, code?: string) =>
  new HttpError(401, message, code);
export const notFound = (message: string, code?: string) => new HttpError(404, message, code);
export const conflict = (message: string, code?: string) => new HttpError(409, message, code);
