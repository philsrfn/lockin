import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAuth } from './auth';
import { pool } from './db';
import { env } from './env';
import { HttpError } from './errors';
import { LlmError } from './llm/provider';
import { registerRoutes } from './routes/index';
import { exercisesByName } from './services/exercises';
import { jobHandlers } from './jobs/handlers';
import { startScheduler } from './jobs/scheduler';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // A phone on gym wifi retries; a slow body should not hold a socket open.
    requestTimeout: 20_000,
    // Deployed behind the host's TLS terminator, so the real client address
    // arrives in X-Forwarded-For.
    trustProxy: true,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }

    if (error instanceof LlmError) {
      // The trainer being unreachable is not a bug in the app. 503 so the
      // phone knows to retry rather than showing a crash.
      request.log.warn({ err: error }, 'llm call failed');
      return reply.code(error.retryable ? 503 : 400).send({ error: error.message });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Invalid request',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    // Anything else is a bug, not a client mistake: log it in full, tell the
    // phone nothing beyond the status code.
    request.log.error({ err: error }, 'unhandled error');
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status >= 400 ? status : 500).send({ error: 'Internal error' });
  });

  registerAuth(app);
  await registerRoutes(app);

  return app;
}

async function start(): Promise<void> {
  const app = await buildServer();

  // Fail at boot, not mid-workout: the training templates reference exercises
  // by name, and this is where a drifted name shows up.
  await exercisesByName();

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

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
