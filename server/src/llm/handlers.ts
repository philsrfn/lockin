/**
 * Tool dispatch. Each handler validates, calls the same service the REST routes
 * call, and returns the resulting state — §6: "any tool that writes returns the
 * resulting state, so the model's next turn sees ground truth rather than
 * assuming its call succeeded."
 *
 * Handlers never throw at the model. A failure comes back as
 * { ok: false, error } so the trainer can say what went wrong instead of
 * pretending it worked.
 */
import { HttpError } from '../errors';
import { logWeight, summary as weightSummary } from '../services/bodyweight';
import { activateContext, listContexts } from '../services/contexts';
import { listExercises } from '../services/exercises';
import { logMeal } from '../services/meals';
import { getProfile, updateTargets } from '../services/profile';
import { addRule, deactivateRule, listRules } from '../services/rules';
import { createSession, finishSession, listSessions, openSession } from '../services/sessions';
import { recordSet } from '../services/sets';
import { getToday } from '../services/today';
import { prescribeExercise, upcomingTemplate } from '../services/workouts';
import type { ToolCall } from './provider';

export type ToolOutcome = Record<string, unknown> & { ok: boolean };

const fail = (error: string, hint?: string): ToolOutcome => ({ ok: false, error, ...(hint ? { hint } : {}) });

/** Exercise names come from the model, so match generously but never guess wildly. */
async function resolveExercise(name: string) {
  const exercises = await listExercises();
  const wanted = name.trim().toLowerCase();

  return (
    exercises.find((exercise) => exercise.name.toLowerCase() === wanted) ??
    exercises.find((exercise) => exercise.name.toLowerCase().includes(wanted)) ??
    exercises.find((exercise) => wanted.includes(exercise.name.toLowerCase())) ??
    null
  );
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<ToolOutcome>> = {
  async get_today() {
    return { ok: true, today: await getToday() };
  },

  async get_history(args) {
    const days = Math.min(Math.max(Number(args.days ?? 14), 1), 90);
    const [sessions, weight] = await Promise.all([
      listSessions(30),
      weightSummary(days),
    ]);
    return {
      ok: true,
      days,
      sessions: sessions.slice(0, 15),
      weight: { latest: weight.latest, average7: weight.average7, changeKg: weight.changeKg },
    };
  },

  async set_context(args) {
    const name = String(args.name ?? '').trim();
    const contexts = await listContexts();
    const match = contexts.find(
      (context) => context.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      return fail(`No context called "${name}"`, `Known: ${contexts.map((c) => c.name).join(', ')}`);
    }
    return { ok: true, contexts: await activateContext(match.id) };
  },

  async log_weight(args) {
    const result = await logWeight({
      weightKg: Number(args.weightKg),
      measuredOn: args.measuredOn ? String(args.measuredOn) : undefined,
    });
    return { ok: true, entry: result.entry, average7: result.summary.average7, changeKg: result.summary.changeKg };
  },

  async log_set(args) {
    const session = await openSession();
    if (!session) {
      return fail('No session is open', 'Call log_session with action "start" first.');
    }

    const exercise = await resolveExercise(String(args.exerciseName ?? ''));
    if (!exercise) return fail(`No exercise matching "${args.exerciseName}"`);

    const alreadyLogged = session.sets.filter((set) => set.exerciseId === exercise.id).length;

    const { session: updated } = await recordSet({
      sessionId: session.id,
      exerciseId: exercise.id,
      setIndex: alreadyLogged + 1,
      weightKg: Number(args.weightKg),
      reps: Number(args.reps),
      rir: args.rir === undefined ? null : Number(args.rir),
    });

    return { ok: true, exercise: exercise.name, session: updated };
  },

  async log_session(args) {
    const action = String(args.action ?? '');

    if (action === 'start') {
      const existing = await openSession();
      if (existing) return { ok: true, alreadyOpen: true, session: existing };

      const template = ['A', 'B', 'C'].includes(String(args.template))
        ? (String(args.template) as 'A' | 'B' | 'C')
        : await upcomingTemplate();

      return { ok: true, session: await createSession({ template }) };
    }

    if (action === 'finish') {
      const session = await openSession();
      if (!session) return fail('No session is open to finish');

      return {
        ok: true,
        session: await finishSession(session.id, {
          rpe: args.rpe === undefined ? null : Number(args.rpe),
          notes: args.notes === undefined ? null : String(args.notes),
          jointPain: args.jointPain === undefined ? undefined : Boolean(args.jointPain),
        }),
      };
    }

    return fail('action must be "start" or "finish"');
  },

  async log_meal(args) {
    const result = await logMeal({
      slot: String(args.slot) as 'breakfast' | 'lunch' | 'dinner' | 'snack',
      description: String(args.description ?? ''),
      kcal: args.kcal === undefined ? null : Number(args.kcal),
      proteinG: args.proteinG === undefined ? null : Number(args.proteinG),
      source: args.source === undefined ? null : String(args.source),
    });

    const profile = await getProfile();
    return {
      ok: true,
      meal: result.meal,
      consumedToday: result.today,
      proteinRemaining: profile.proteinTargetG - result.today.proteinG,
      kcalRemaining: profile.calorieTarget - result.today.kcal,
    };
  },

  async swap_exercise(args) {
    const from = await resolveExercise(String(args.from ?? ''));
    const to = await resolveExercise(String(args.to ?? ''));
    if (!from) return fail(`No exercise matching "${args.from}"`);
    if (!to) return fail(`No exercise matching "${args.to}"`);

    if (from.pattern !== to.pattern) {
      return fail(
        `${to.name} is a ${to.pattern} movement and ${from.name} is a ${from.pattern}. Substitutes must share the pattern.`,
      );
    }

    const session = await openSession();
    return {
      ok: true,
      // A swap is a suggestion until he logs a set against it; nothing is
      // written here beyond telling him the right load to use.
      prescription: await prescribeExercise(to.id, { excludeSessionId: session?.id }),
      replaced: from.name,
    };
  },

  async adjust_calorie_target(args) {
    if (!String(args.reason ?? '').trim()) {
      return fail('A reason is required — he should always know why a target moved.');
    }

    const { profile, refusals } = await updateTargets({
      calorieTarget: args.calorieTarget === undefined ? undefined : Number(args.calorieTarget),
      proteinTargetG: args.proteinTargetG === undefined ? undefined : Number(args.proteinTargetG),
      goalWeightKg: args.goalWeightKg === undefined ? undefined : Number(args.goalWeightKg),
    });

    return {
      ok: true,
      profile,
      // Not an error: the write happened, but clamped. He must be told.
      refusals,
      mustTellHim: refusals.length > 0,
    };
  },

  async add_rule(args) {
    const result = await addRule({
      tier: String(args.tier) as 'hard' | 'soft' | 'never',
      text: String(args.text ?? ''),
      scope: args.scope === undefined ? null : String(args.scope),
    });
    return {
      ok: true,
      rule: result.rule,
      enforceable: result.enforceable,
      note: 'Saved and shown to you every session, but not machine-checked — only the seeded rules have validators.',
    };
  },

  async deactivate_rule(args) {
    return { ok: true, rule: await deactivateRule(Number(args.ruleId)), rules: await listRules() };
  },
};

export async function runTool(call: ToolCall): Promise<ToolOutcome> {
  const handler = HANDLERS[call.name];
  if (!handler) return fail(`Unknown tool "${call.name}"`);

  try {
    return await handler(call.args);
  } catch (error) {
    // A tool failure is information for the trainer, not a crashed request.
    const message = error instanceof HttpError ? error.message : 'Something went wrong';
    return fail(message);
  }
}
