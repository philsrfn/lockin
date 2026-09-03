import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import {
  CreateSessionSchema,
  FinishSessionSchema,
  IdParamSchema,
  LogWeightSchema,
  RecordSetSchema,
  AddRuleSchema,
  BarcodeQuerySchema,
  EstimateFoodSchema,
  FridgePhotoSchema,
  JobNameSchema,
  MealPlanSchema,
  OnboardingSchema,
  AppleSignInSchema,
  ChooseProgramSchema,
  HealthSyncSchema,
  LogCardioSchema,
  LogMeasurementSchema,
  SetDeloadSchema,
  SaveContextSchema,
  UpdateContextSchema,
  LogFoodSchema,
  LogMealSchema,
  RegisterPushSchema,
  SaveScannedSchema,
  UpdateRuleSchema,
  SaveFoodSchema,
  SyncBatchSchema,
  TemplateIdSchema,
  UpdateFoodSchema,
  UpdateProfileSchema,
} from '../schemas';
import { logWeight, summary as weightSummary } from '../services/bodyweight';
import {
  activateContext,
  archiveContext,
  createContext,
  listContexts,
  updateContext,
} from '../services/contexts';
import { listExercises } from '../services/exercises';
import { getProfile, isOnboarded, setLocale, setTimezone } from '../services/profile';
import { verifyAppleIdentityToken } from '../auth/appleIdentity';
import { consumeNonce, issueNonce } from '../auth/nonce';
import {
  accountKind,
  appleLinked,
  deleteAccount,
  findOrCreateAppleUser,
  getUser,
  issueToken,
  linkAppleAccount,
  revokeToken,
  unlinkAppleAccount,
} from '../services/users';
import { env } from '../env';
import { unauthorized } from '../errors';
import { completeOnboarding } from '../services/onboarding';
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
import { getWeek } from '../services/week';
import { archiveFood, createFood, getFood, listFoods, updateFood } from '../services/foods';
import { lookupBarcode, saveScanned } from '../services/barcode';
import { estimateFood } from '../llm/food';
import { generateWeeklyReview, latestReview } from '../llm/review';
import { generateMealPlan, readFridgePhoto } from '../llm/fridge';
import { jobHandlers, recentRuns } from '../jobs/handlers';
import { forceRun } from '../jobs/scheduler';
import { registerToken, sendPush } from '../push';
import { deleteCardio, logCardio, recentCardio } from '../services/cardio';
import { currentDeload, setDeloadEvery } from '../services/deloads';
import { recoverySignals, syncHealth } from '../services/health';
import { usageToday } from '../services/usage';
import {
  deleteMeasurement,
  listMeasurements,
  logMeasurement,
} from '../services/measurements';
import { deleteMeal, logMeal, mealsToday } from '../services/meals';
import { history, sendMessage } from '../llm/chat';
import { noteForToday } from '../llm/coach';
import { addRule, listRules, updateRule } from '../services/rules';
import { currentProgram, listPrograms, setProgram } from '../services/programs';
import { planFor, prescribeExercise, progress, upcomingTemplate } from '../services/workouts';
import { registerAdminRoutes } from './admin';

/**
 * Routes are deliberately thin. Every write goes through a service, and the
 * sync queue calls the same service — §11: never two code paths to one table.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Who is using this, and what it costs. Behind requireAdmin, which answers
  // 404 to everybody else.
  registerAdminRoutes(app);

  /**
   * Sign in with Apple. Both of these are reachable without a token — they are
   * how a token is obtained — and both are rate limited hard.
   *
   * The nonce is issued by the server rather than made up by the client: that
   * is what makes a captured identity token useless a second time.
   */
  app.post('/auth/apple/nonce', async () => ({ nonce: issueNonce() }));

  app.post('/auth/apple', async (request) => {
    const body = AppleSignInSchema.parse(request.body);

    if (!consumeNonce(body.nonce)) {
      throw unauthorized('That sign-in took too long. Try again.');
    }

    const identity = await verifyAppleIdentityToken(body.identityToken, {
      audience: env.appleBundleId,
      expectedNonce: body.nonce,
    });

    const { user, isNew } = await findOrCreateAppleUser({
      sub: identity.sub,
      email: identity.email,
      name: body.name,
      timezone: body.timezone,
      locale: body.locale,
    });

    const token = await issueToken(user.id, { source: 'apple', device: body.device });
    const onboarded = await isOnboarded(user.id);

    // The token is returned once and stored only as a hash. Everything the app
    // needs to decide where to send them comes back with it — including
    // whether it may go anywhere at all: a new account is created here but not
    // admitted, and the app shows a waiting screen rather than an app that
    // 403s on every screen.
    return { token, user, isNew, onboarded, approved: user.approvedAt !== null };
  });

  /** Signing out this device, and only this device. */
  app.post('/auth/signout', async (request) => {
    const header = request.headers.authorization ?? '';
    if (header.startsWith('Bearer ')) await revokeToken(header.slice('Bearer '.length));
    return { signedOut: true };
  });

  /**
   * Who is signed in, and whether this app may offer to delete them. The App
   * Store requires an account made with Sign in with Apple to be removable
   * from inside the app; a root token is the operator's to withdraw.
   */
  app.get('/account', async (request) => ({
    user: await getUser(request.ctx.userId),
    kind: await accountKind(request.ctx.userId),
    // So the app knows whether to offer the admin controls at all.
    isAdmin: request.user.isAdmin,
    // And whether this account can be opened with Apple on a new phone.
    appleLinked: await appleLinked(request.ctx.userId),
  }));

  /**
   * Attaching an Apple ID to the account already signed in here.
   *
   * The same verification as signing in — this hands somebody a permanent way
   * into an account, so it is held to exactly the standard that minting a
   * token is. The difference is only which row the verified `sub` lands on.
   */
  app.post('/account/apple', async (request) => {
    const body = AppleSignInSchema.parse(request.body);

    if (!consumeNonce(body.nonce)) {
      throw unauthorized('That took too long. Try again.');
    }

    const identity = await verifyAppleIdentityToken(body.identityToken, {
      audience: env.appleBundleId,
      expectedNonce: body.nonce,
    });

    return linkAppleAccount(request.ctx.userId, { sub: identity.sub, email: identity.email });
  });

  app.delete('/account/apple', async (request) => {
    await unlinkAppleAccount(request.ctx.userId);
    return { linked: false };
  });

  app.delete('/account', async (request) => {
    await deleteAccount(request.ctx.userId);
    return { deleted: true };
  });

  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true, db: true };
    } catch {
      return reply.code(503).send({ ok: false, db: false });
    }
  });

  app.get('/profile', async (request) => ({ profile: await getProfile(request.ctx) }));

  /**
   * The questionnaire. Height, weight, goal and training days in; calories,
   * protein and the fat floor out, computed in code and explained.
   *
   * Idempotent — running it again re-computes from the new answers, because
   * "I got that wrong, let me redo it" is a thing people do.
   */
  app.post('/onboarding', async (request) => {
    const body = OnboardingSchema.parse(request.body);
    return completeOnboarding(request.ctx, body);
  });

  /**
   * Where he is. Everything that says "today" — the week strip, the macros, the
   * 07:30 check-in — is measured against this.
   */
  app.patch('/profile', async (request) => {
    const body = UpdateProfileSchema.parse(request.body);
    if (body.timezone !== undefined) await setTimezone(request.ctx, body.timezone);
    if (body.locale !== undefined) await setLocale(request.ctx, body.locale);
    return { profile: await getProfile(request.ctx) };
  });

  app.get('/contexts', async (request) => ({ contexts: await listContexts(request.ctx) }));

  app.post('/contexts/:id/activate', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { contexts: await activateContext(request.ctx, id) };
  });

  app.post('/contexts', async (request, reply) => {
    const body = SaveContextSchema.parse(request.body);
    return reply.code(201).send({ contexts: await createContext(request.ctx, body) });
  });

  app.patch('/contexts/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = UpdateContextSchema.parse(request.body);
    return { contexts: await updateContext(request.ctx, id, body) };
  });

  /** Archived, not deleted: sessions carry the place they were performed in. */
  app.delete('/contexts/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { contexts: await archiveContext(request.ctx, id) };
  });

  app.get('/exercises', async () => ({ exercises: await listExercises() }));

  /**
   * The catalogue, and which one he is on. §14: a short list of programmes
   * that work, not a builder.
   */
  app.get('/programs', async (request) => ({
    programs: await listPrograms(request.ctx),
    current: await currentProgram(request.ctx),
  }));

  /**
   * Switching. History keeps the day codes it was logged against; the rotation
   * starts at the top of the new programme, because "what follows C in
   * upper/lower" has no honest answer.
   */
  app.post('/programs/choose', async (request) => {
    const body = ChooseProgramSchema.parse(request.body);
    return { current: await setProgram(request.ctx, body.programId) };
  });

  app.get('/today', async (request) => getToday(request.ctx));

  /** The seven-day shape the home screen is built on. */
  app.get('/week', async (request) => getWeek(request.ctx));

  app.get('/workouts/next', async (request) => {
    const query = z.object({ template: TemplateIdSchema.optional() }).parse(request.query);
    const template = query.template ?? (await upcomingTemplate(request.ctx));
    const open = await openSession(request.ctx);
    return planFor(request.ctx, template, { excludeSessionId: open?.id });
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
      prescription: await prescribeExercise(request.ctx, id, {
        excludeSessionId: query.excludeSessionId,
        targetSets: query.sets,
      }),
    };
  });

  app.get('/progress', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(7).max(365).default(90) })
      .parse(request.query);
    return progress(request.ctx, query.days);
  });

  app.get('/sessions', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(20) })
      .parse(request.query);
    return { sessions: await listSessions(request.ctx, query.limit) };
  });

  app.get('/sessions/open', async (request) => ({ session: await openSession(request.ctx) }));

  app.get('/sessions/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { session: await getSession(request.ctx, id) };
  });

  app.post('/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body);
    return reply.code(201).send({ session: await createSession(request.ctx, body) });
  });

  app.patch('/sessions/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = FinishSessionSchema.parse(request.body);
    return { session: await finishSession(request.ctx, id, body) };
  });

  app.post('/sets', async (request, reply) => {
    const body = RecordSetSchema.parse(request.body);
    const { setId, session } = await recordSet(request.ctx, body);
    return reply.code(201).send({ setId, session });
  });

  app.delete('/sets/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { session: await deleteSet(request.ctx, id) };
  });

  /**
   * Cardio. §4's week is three strength sessions and two zone-2 — the second
   * half had nowhere to be logged, so the weekly tally silently dropped it.
   */
  app.get('/cardio', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(14) })
      .parse(request.query);
    return { sessions: await recentCardio(request.ctx, query.days) };
  });

  app.post('/cardio', async (request, reply) => {
    const body = LogCardioSchema.parse(request.body);
    return reply.code(201).send({ session: await logCardio(request.ctx, body) });
  });

  app.delete('/cardio/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await deleteCardio(request.ctx, id);
    return { deleted: true };
  });

  /**
   * Waist and the rest of the tape. Weight alone stalls for a fortnight while
   * the mirror keeps changing, and that fortnight is where people quit.
   */
  app.get('/measurements', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(1000).default(180) })
      .parse(request.query);
    return { measurements: await listMeasurements(request.ctx, query.days) };
  });

  app.post('/measurements', async (request, reply) => {
    const body = LogMeasurementSchema.parse(request.body);
    return reply.code(201).send({ measurement: await logMeasurement(request.ctx, body) });
  });

  app.delete('/measurements/:date', async (request) => {
    const { date } = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(request.params);
    await deleteMeasurement(request.ctx, date);
    return { deleted: true };
  });

  /**
   * Apple Health. Idempotent by design — the phone sends a window on every
   * foreground rather than tracking what it has already sent.
   *
   * Deliberately not under /health: that is the unauthenticated liveness probe,
   * and a prefix match added there one day would make this public.
   */
  app.post('/vitals/sync', async (request) => ({
    result: await syncHealth(request.ctx, HealthSyncSchema.parse(request.body)),
  }));

  /** Steps, sleep and resting heart rate, as the coach reads them. */
  app.get('/vitals', async (request) => ({ signals: await recoverySignals(request.ctx) }));

  /** Scheduled light weeks. 0 turns them off. */
  app.get('/deload', async (request) => ({ deload: await currentDeload(request.ctx) }));

  /** What the trainer has cost today, and what is left. */
  app.get('/usage', async (request) => ({ usage: await usageToday(request.ctx) }));

  app.patch('/deload', async (request) => {
    const body = SetDeloadSchema.parse(request.body);
    return { deload: await setDeloadEvery(request.ctx, body.everyWeeks) };
  });

  app.get('/bodyweight', async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })
      .parse(request.query);
    return weightSummary(request.ctx, query.days);
  });

  app.post('/bodyweight', async (request, reply) => {
    const body = LogWeightSchema.parse(request.body);
    return reply.code(201).send(await logWeight(request.ctx, body));
  });

  // --- proactive coaching (phase 3)

  app.post('/push/register', async (request, reply) => {
    const body = RegisterPushSchema.parse(request.body);
    await registerToken(request.ctx, body.token, body.platform ?? null);
    return reply.code(201).send({ registered: true });
  });

  /** Proves the round trip to his phone without waiting for 07:30. */
  app.post('/push/test', async (request) => ({
    result: await sendPush(request.ctx, {
      title: 'lockin',
      body: 'Notifications are working.',
      data: { screen: 'today' },
    }),
  }));

  app.get('/review', async (request) => ({ review: await latestReview(request.ctx) }));

  app.post('/review/generate', async (request) => ({
    review: await generateWeeklyReview(request.ctx),
  }));

  app.get('/jobs', async (request) => ({ runs: await recentRuns(request.ctx) }));

  /** Manual trigger, so a job can be checked without waiting a week for it. */
  app.post('/jobs/:job/run', async (request) => {
    const { job } = z.object({ job: JobNameSchema }).parse(request.params);
    return { result: await forceRun(request.ctx, job, jobHandlers[job]) };
  });

  app.get('/rules', async (request) => ({ rules: await listRules(request.ctx) }));

  app.post('/rules', async (request, reply) => {
    const body = AddRuleSchema.parse(request.body);
    const result = await addRule(request.ctx, body);
    return reply.code(201).send({ ...result, rules: await listRules(request.ctx) });
  });

  app.patch('/rules/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = UpdateRuleSchema.parse(request.body);
    await updateRule(request.ctx, id, body);
    return { rules: await listRules(request.ctx) };
  });

  // --- food (phase 4). All new paths; nothing existing changed, so the build
  // already on his phone keeps working untouched.

  app.get('/foods', async (request) => ({ foods: await listFoods(request.ctx) }));

  app.post('/foods', async (request, reply) => {
    const body = SaveFoodSchema.parse(request.body);
    return reply.code(201).send({ food: await createFood(request.ctx, body) });
  });

  app.patch('/foods/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = UpdateFoodSchema.parse(request.body);
    return { food: await updateFood(request.ctx, id, body) };
  });

  // Archived, not deleted: meals already logged against it keep their history.
  app.delete('/foods/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await archiveFood(request.ctx, id);
    return { foods: await listFoods(request.ctx) };
  });

  /**
   * Barcode lookup. Returns a candidate to confirm — nothing is written until
   * he agrees with the numbers.
   */
  app.get('/foods/barcode', async (request) => {
    const query = BarcodeQuerySchema.parse(request.query);
    return { candidate: await lookupBarcode(request.ctx, query.barcode) };
  });

  /** Keeps a scanned product, so the next scan of it needs no network. */
  app.post('/foods/scanned', async (request, reply) => {
    const body = SaveScannedSchema.parse(request.body);
    return reply.code(201).send({ food: await saveScanned(request.ctx, body) });
  });

  /**
   * Macros estimated from a plain-text description. A candidate, not a log
   * entry: he confirms or corrects it first, per the §9 principle.
   */
  app.post('/foods/estimate', async (request) => {
    const body = EstimateFoodSchema.parse(request.body);
    return { estimate: await estimateFood(request.ctx, body.text) };
  });

  /**
   * §9: vision returns candidates and stops. The photo is passed to the model
   * and dropped — nothing is written and nothing is stored.
   */
  app.post('/fridge/read', async (request) => {
    const body = FridgePhotoSchema.parse(request.body);
    return { items: await readFridgePhoto(request.ctx, body.imageBase64, body.mimeType) };
  });

  /**
   * Plans against what is LEFT of today (§9 step 5), and only from a list he
   * has confirmed — `confirmed: true` is required, so an unedited vision pass
   * cannot reach here by accident.
   */
  app.post('/fridge/plan', async (request) => {
    const body = MealPlanSchema.parse(request.body);
    return { plan: await generateMealPlan(request.ctx, body.items) };
  });

  app.get('/meals', async (request) => ({ meals: await mealsToday(request.ctx) }));

  app.post('/meals', async (request, reply) => {
    const body = LogMealSchema.parse(request.body);
    const result = await logMeal(request.ctx, body);
    return reply.code(201).send({ meal: result.meal, consumed: result.today });
  });

  /** One tap on a quick-add tile. The library supplies the macros. */
  app.post('/meals/from-food', async (request, reply) => {
    const body = LogFoodSchema.parse(request.body);
    const food = await getFood(request.ctx, body.foodId);
    const result = await logMeal(request.ctx, {
      slot: body.slot ?? food.defaultSlot ?? 'snack',
      description: food.name,
      kcal: food.kcal,
      proteinG: food.proteinG,
      fatG: food.fatG,
      carbsG: food.carbsG,
      foodId: food.id,
    });
    return reply.code(201).send({ meal: result.meal, consumed: result.today });
  });

  app.delete('/meals/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const result = await deleteMeal(request.ctx, id);
    return { consumed: result.today };
  });

  /**
   * Generates today's coach note if it does not exist yet. The app calls this
   * after rendering Today, so the deterministic plan is never behind a model
   * call.
   */
  app.post('/coach/today', async (request) => {
    const body = z.object({ force: z.boolean().optional() }).parse(request.body ?? {});
    return { coach: await noteForToday(request.ctx, { force: body.force }) };
  });

  app.get('/chat', async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(request.query);
    return { messages: await history(request.ctx, query.limit) };
  });

  app.post('/chat', async (request) => {
    const body = z.object({ text: z.string().min(1).max(4000) }).parse(request.body);
    return sendMessage(request.ctx, body.text);
  });

  app.post('/sync', async (request) => {
    const body = SyncBatchSchema.parse(request.body);
    return { results: await drain(request.ctx, body.ops) };
  });
}
