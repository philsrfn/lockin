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

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message: string) => new HttpError(401, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
