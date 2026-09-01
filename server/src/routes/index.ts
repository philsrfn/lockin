import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import {
  CreateSessionSchema,
  FinishSessionSchema,
  IdParamSchema,
  LogWeightSchema,
  RecordSetSchema,
  SyncBatchSchema,
  TemplateIdSchema,
} from '../schemas';
import { logWeight, summary as weightSummary } from '../services/bodyweight';
import { activateContext, listContexts } from '../services/contexts';
import { listExercises } from '../services/exercises';
import { getProfile } from '../services/profile';
import {
  createSession,
  finishSession,
  getSession,
  listSessions,
  openSession,
} from '../services/sessions';
import { deleteSet, recordSet } from '../services/sets';
import { drain } from '../services/sync';
import { getToday } from '../services/today';
import { history, sendMessage } from '../llm/chat';
import { noteForToday } from '../llm/coach';
import { listRules } from '../services/rules';
import { planFor, prescribeExercise, upcomingTemplate } from '../services/workouts';

/**
 * Routes are deliberately thin. Every write goes through a service, and the
 * sync queue calls the same service — §11: never two code paths to one table.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true, db: true };
    } catch {
      return reply.code(503).send({ ok: false, db: false });
    }
  });

  app.get('/profile', async () => ({ profile: await getProfile() }));

  app.get('/contexts', async () => ({ contexts: await listContexts() }));

  app.post('/contexts/:id/activate', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { contexts: await activateContext(id) };
  });

  app.get('/exercises', async () => ({ exercises: await listExercises() }));

  app.get('/today', async () => getToday());

  app.get('/workouts/next', async (request) => {
    const query = z.object({ template: TemplateIdSchema.optional() }).parse(request.query);
    const template = query.template ?? (await upcomingTemplate());
    const open = await openSession();
    return planFor(template, { excludeSessionId: open?.id });
  });

  // Used by the swap button: the substitute's own history decides its load.
  app.get('/exercises/:id/prescription', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const query = z
      .object({
        excludeSessionId: z.coerce.number().int().positive().optional(),
        sets: z.coerce.number().int().min(1).max(10).optional(),
      })
      .parse(request.query);

    return {
      prescription: await prescribeExercise(id, {
        excludeSessionId: query.excludeSessionId,
        targetSets: query.sets,
      }),
    };
  });

  app.get('/sessions', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(20) })
      .parse(request.query);
    return { sessions: await listSessions(query.limit) };
  });

  app.get('/sessions/open', async () => ({ session: await openSession() }));

  app.get('/sessions/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { session: await getSession(id) };
  });

  app.post('/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body);
    return reply.code(201).send({ session: await createSession(body) });
  });

  app.patch('/sessions/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = FinishSessionSchema.parse(request.body);
    return { session: await finishSession(id, body) };
  });

  app.post('/sets', async (request, reply) => {
    const body = RecordSetSchema.parse(request.body);
    const { setId, session } = await recordSet(body);
    return reply.code(201).send({ setId, session });
  });

  app.delete('/sets/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { session: await deleteSet(id) };
  });

  app.get('/bodyweight', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })
      .parse(request.query);
    return weightSummary(query.days);
  });

  app.post('/bodyweight', async (request, reply) => {
    const body = LogWeightSchema.parse(request.body);
    return reply.code(201).send(await logWeight(body));
  });

  app.get('/rules', async () => ({ rules: await listRules() }));

  /**
   * Generates today's coach note if it does not exist yet. The app calls this
   * after rendering Today, so the deterministic plan is never behind a model
   * call.
   */
  app.post('/coach/today', async (request) => {
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
    return { coach: await noteForToday({ force: body.force }) };
  });

  app.get('/chat', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    return { messages: await history(query.limit) };
  });

  app.post('/chat', async (request) => {
    const body = z.object({ text: z.string().min(1).max(4000) }).parse(request.body);
    return sendMessage(body.text);
  });

  app.post('/sync', async (request) => {
    const body = SyncBatchSchema.parse(request.body);
    return { results: await drain(body.ops) };
  });
}
