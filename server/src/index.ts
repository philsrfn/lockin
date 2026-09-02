import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAuth } from './auth';
import { pool } from './db';
import { env } from './env';
import { HttpError } from './errors';
import { LlmError } from './llm/provider';
import { loggerOptions, requestIdFor, useLogger } from './logging';
import { registerRateLimit } from './rateLimit';
import { registerRoutes } from './routes/index';
import { exercisesByName } from './services/exercises';
import { syncRootToken } from './services/users';
import { jobHandlers } from './jobs/handlers';
import { startScheduler } from './jobs/scheduler';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    // One id per request, echoed back to the caller and stamped on every log
    // line and error body it produces.
    genReqId: (request) => requestIdFor(request as { headers: Record<string, unknown> }),
    // A phone on gym wifi retries; a slow body should not hold a socket open.
    requestTimeout: 20_000,
    // Fastify defaults to 1MB, which a base64 fridge photo exceeds immediately.
    // The failure is a bare 413 with no clue what happened.
    bodyLimit: 12 * 1024 * 1024,
    // Deployed behind the host's TLS terminator, so the real client address
    // arrives in X-Forwarded-For.
    trustProxy: true,
  });

  // Every response carries its id, so a screenshot of a failure is enough to
  // find the request that caused it.
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message, requestId });
    }

    if (error instanceof LlmError) {
      // The trainer being unreachable is not a bug in the app. 503 so the
      // phone knows to retry rather than showing a crash.
      request.log.warn({ err: error }, 'llm call failed');
      return reply.code(error.retryable ? 503 : 400).send({ error: error.message, requestId });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        requestId,
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    // Anything else is a bug, not a client mistake: log it in full, tell the
    // phone nothing beyond the status code and the id to quote back.
    request.log.error({ err: error }, 'unhandled error');
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status >= 400 ? status : 500).send({ error: 'Internal error', requestId });
  });

  registerAuth(app);
  // After auth, so the bucket is keyed by athlete rather than by address —
  // one person on hotel wifi must not spend another's allowance.
  registerRateLimit(app);
  await registerRoutes(app);

  // Jobs, the scheduler and the LLM layer log through the same stream from
  // here on, instead of writing to console and out of the structured log.
  useLogger(app.log);

  return app;
}

async function start(): Promise<void> {
  const app = await buildServer();

  // Fail at boot, not mid-workout: the training templates reference exercises
  // by name, and this is where a drifted name shows up.
  await exercisesByName();

  // The deployed bearer token is still configured as an env var; mirroring its
  // hash onto user 1 means authentication has one code path for everybody and
  // the phone in his pocket keeps working across this change.
  await syncRootToken(env.bearerToken);

  await app.listen({ port: env.port, host: env.host });

  // Proactive coaching (§8). Runs in-process: one user, one box, and a separate
  // worker would be more moving parts than the work justifies.
  const stopScheduler = startScheduler(jobHandlers);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      stopScheduler();
      void app.close().then(() => pool.end()).then(() => process.exit(0));
    });
  }
}

// Run directly: `npm start`. Importing this module — which the route tests do,
// to exercise the real error handler and auth hook — must not bind a port or
// start the scheduler.
const isEntrypoint =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
