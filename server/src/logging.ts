/**
 * Request correlation and one log stream.
 *
 * A 500 used to return `{"error":"Internal error"}` and nothing else. With one
 * user that is survivable — he says "it broke around six" and there is one
 * server's log to read. It stops being survivable the moment somebody else is
 * using this: the first support message would be unanswerable.
 *
 * So every request carries an id, the id comes back on the response and in the
 * error body, and everything the process logs — jobs and the scheduler
 * included — goes through the same structured logger rather than console.log.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

/** Short enough to read out over a message, long enough not to collide. */
export function newRequestId(): string {
  return randomBytes(8).toString('hex');
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Honour a client-supplied id so a trace can span the phone and the server,
 * but never log it unchecked — it is attacker-controlled text heading straight
 * into the log stream.
 */
export function requestIdFor(request: { headers: Record<string, unknown> }): string {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && SAFE_ID.test(supplied) ? supplied : newRequestId();
}

/**
 * The process-wide logger. Fastify owns the real one, so it is handed over at
 * boot; until then — and in tests — this writes structured lines to stderr
 * rather than swallowing them.
 */
type Fields = Record<string, unknown>;

export type Logger = {
  info(fields: Fields, message: string): void;
  warn(fields: Fields, message: string): void;
  error(fields: Fields, message: string): void;
};

const fallback: Logger = {
  info: (fields, message) => console.log(JSON.stringify({ level: 'info', message, ...fields })),
  warn: (fields, message) => console.warn(JSON.stringify({ level: 'warn', message, ...fields })),
  error: (fields, message) => console.error(JSON.stringify({ level: 'error', message, ...fields })),
};

let current: Logger = fallback;

export function useLogger(logger: FastifyBaseLogger): void {
  current = {
    info: (fields, message) => logger.info(fields, message),
    warn: (fields, message) => logger.warn(fields, message),
    error: (fields, message) => logger.error(fields, message),
  };
}

export const log: Logger = {
  info: (fields, message) => current.info(fields, message),
  warn: (fields, message) => current.warn(fields, message),
  error: (fields, message) => current.error(fields, message),
};

/** Fastify's logger config: what to record about a request, and what to hide. */
export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  // The bearer token is the whole of authentication. It must never be written
  // to disk, including on the request that failed because it was wrong.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    remove: true,
  },
  serializers: {
    req(request: FastifyRequest) {
      return {
        id: request.id,
        method: request.method,
        // The path only — a query string can carry a barcode or a search term.
        url: request.url.split('?')[0],
        route: request.routeOptions?.url,
        remote: request.ip,
      };
    },
  },
};
