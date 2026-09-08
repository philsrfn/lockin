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
import type { Ctx } from '../db';
import { HttpError } from '../errors';
import { inventoryAge } from '../domain/fridge';
import { generateMealPlan } from './fridge';
import { latestInventory } from '../services/fridge';
import { LlmError } from './provider';
import { logWeight, summary as weightSummary } from '../services/bodyweight';
import { activateContext, createContext, listContexts } from '../services/contexts';
import { listExercises } from '../services/exercises';
import { type CardioKind, logCardio } from '../services/cardio';
import { deleteMeal, logMeal } from '../services/meals';
import { getProfile, setTrainingDays, updateTargets } from '../services/profile';
import { addRule, deactivateRule, listRules } from '../services/rules';
import { createSession, finishSession, listSessions, openSession } from '../services/sessions';
import { deleteSet, recordSet } from '../services/sets';
import { getToday } from '../services/today';
import {
  createProgram,
  currentProgram,
  listPrograms,
  programWithSlots,
  saveProgram,
  setProgram,
} from '../services/programs';
import { getWeek } from '../services/week';
import { prescribeExercise, upcomingTemplate } from '../services/workouts';
import type { ToolCall } from './provider';

export type ToolOutcome = Record<string, unknown> & { ok: boolean };

const fail = (error: string, hint?: string): ToolOutcome => ({ ok: false, error, ...(hint ? { hint } : {}) });

/** Exercise names come from the model, so match generously but never guess wildly. */
async function resolveExercise(ctx: Ctx, name: string) {
  const exercises = await listExercises(ctx.db);
  const wanted = name.trim().toLowerCase();

  return (
    exercises.find((exercise) => exercise.name.toLowerCase() === wanted) ??
    exercises.find((exercise) => exercise.name.toLowerCase().includes(wanted)) ??
    exercises.find((exercise) => wanted.includes(exercise.name.toLowerCase())) ??
    null
  );
}

const HANDLERS: Record<
  string,
  (ctx: Ctx, args: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  async get_today(ctx) {
    return { ok: true, today: await getToday(ctx) };
  },

  async get_history(ctx, args) {
    const days = Math.min(Math.max(Number(args.days ?? 14), 1), 90);
    const [sessions, weight] = await Promise.all([
      listSessions(ctx, 30),
      weightSummary(ctx, days),
    ]);
    return {
      ok: true,
      days,
      sessions: sessions.slice(0, 15),
      weight: { latest: weight.latest, average7: weight.average7, changeKg: weight.changeKg },
    };
  },

  async set_context(ctx, args) {
    const name = String(args.name ?? '').trim();
    const contexts = await listContexts(ctx);
    const match = contexts.find(
      (context) => context.name.toLowerCase() === name.toLowerCase(),
    );
    if (!match) {
      return fail(`No context called "${name}"`, `Known: ${contexts.map((c) => c.name).join(', ')}`);
    }
    return { ok: true, contexts: await activateContext(ctx, match.id) };
  },

  async log_weight(ctx, args) {
    const result = await logWeight(ctx, {
      weightKg: Number(args.weightKg),
      measuredOn: args.measuredOn ? String(args.measuredOn) : undefined,
    });
    return { ok: true, entry: result.entry, average7: result.summary.average7, changeKg: result.summary.changeKg };
  },

  async log_set(ctx, args) {
    const session = await openSession(ctx);
    if (!session) {
      return fail('No session is open', 'Call log_session with action "start" first.');
    }

    const exercise = await resolveExercise(ctx, String(args.exerciseName ?? ''));
    if (!exercise) return fail(`No exercise matching "${args.exerciseName}"`);

    const alreadyLogged = session.sets.filter((set) => set.exerciseId === exercise.id).length;

    const { session: updated } = await recordSet(ctx, {
      sessionId: session.id,
      exerciseId: exercise.id,
      setIndex: alreadyLogged + 1,
      weightKg: Number(args.weightKg),
      reps: Number(args.reps),
      rir: args.rir === undefined ? null : Number(args.rir),
    });

    return { ok: true, exercise: exercise.name, session: updated };
  },

  async log_session(ctx, args) {
    const action = String(args.action ?? '');

    if (action === 'start') {
      const existing = await openSession(ctx);
      if (existing) return { ok: true, alreadyOpen: true, session: existing };

      const template = ['A', 'B', 'C'].includes(String(args.template))
        ? (String(args.template) as 'A' | 'B' | 'C')
        : await upcomingTemplate(ctx);

      return { ok: true, session: await createSession(ctx, { template }) };
    }

    if (action === 'finish') {
      const session = await openSession(ctx);
      if (!session) return fail('No session is open to finish');

      return {
        ok: true,
        session: await finishSession(ctx, session.id, {
          rpe: args.rpe === undefined ? null : Number(args.rpe),
          notes: args.notes === undefined ? null : String(args.notes),
          jointPain: args.jointPain === undefined ? undefined : Boolean(args.jointPain),
        }),
      };
    }

    return fail('action must be "start" or "finish"');
  },

  async log_meal(ctx, args) {
    const result = await logMeal(ctx, {
      slot: String(args.slot) as 'breakfast' | 'lunch' | 'dinner' | 'snack',
      description: String(args.description ?? ''),
      kcal: args.kcal === undefined ? null : Number(args.kcal),
      proteinG: args.proteinG === undefined ? null : Number(args.proteinG),
      source: args.source === undefined ? null : String(args.source),
    });

    const profile = await getProfile(ctx);
    return {
      ok: true,
      meal: result.meal,
      consumedToday: result.today,
      proteinRemaining: profile.proteinTargetG - result.today.proteinG,
      kcalRemaining: profile.calorieTarget - result.today.kcal,
    };
  },

  async log_cardio(ctx, args) {
    const session = await logCardio(ctx, {
      kind: String(args.kind) as CardioKind,
      minutes: Number(args.minutes),
      description: args.description === undefined ? null : String(args.description),
      distanceKm: args.distanceKm === undefined ? null : Number(args.distanceKm),
      avgHr: args.avgHr === undefined ? null : Number(args.avgHr),
      rpe: args.rpe === undefined ? null : Number(args.rpe),
    });

    const week = await getWeek(ctx);
    return {
      ok: true,
      session,
      // §6: the write returns the resulting state, so the next turn is talking
      // about the week as it now is.
      cardioThisWeek: week.cardio,
      countedTowardsTheWeek: session.counts,
    };
  },

  async swap_exercise(ctx, args) {
    const from = await resolveExercise(ctx, String(args.from ?? ''));
    const to = await resolveExercise(ctx, String(args.to ?? ''));
    if (!from) return fail(`No exercise matching "${args.from}"`);
    if (!to) return fail(`No exercise matching "${args.to}"`);

    if (from.pattern !== to.pattern) {
      return fail(
        `${to.name} is a ${to.pattern} movement and ${from.name} is a ${from.pattern}. Substitutes must share the pattern.`,
      );
    }

    const session = await openSession(ctx);
    return {
      ok: true,
      // A swap is a suggestion until he logs a set against it; nothing is
      // written here beyond telling him the right load to use.
      prescription: await prescribeExercise(ctx, to.id, { excludeSessionId: session?.id }),
      replaced: from.name,
    };
  },

  async adjust_calorie_target(ctx, args) {
    if (!String(args.reason ?? '').trim()) {
      return fail('A reason is required — he should always know why a target moved.');
    }

    const { profile, refusals } = await updateTargets(ctx, {
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

  async add_rule(ctx, args) {
    const result = await addRule(ctx, {
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

  async deactivate_rule(ctx, args) {
    return { ok: true, rule: await deactivateRule(ctx, Number(args.ruleId)), rules: await listRules(ctx) };
  },

  /**
   * Removing something logged by mistake.
   *
   * Deliberately narrow: one entry, by id, and only the two kinds a person
   * actually mis-logs. A tool that could delete a range, or a day, would let a
   * misread sentence take away work somebody did.
   */
  async undo_entry(ctx, args) {
    const id = Number(args.id);
    if (!Number.isInteger(id) || id <= 0) return fail('That is not an id');

    if (args.kind === 'meal') {
      const { today } = await deleteMeal(ctx, id);
      return { ok: true, removed: 'meal', consumed: today };
    }
    if (args.kind === 'set') {
      return { ok: true, removed: 'set', session: await deleteSet(ctx, id) };
    }
    return fail(`Cannot remove a "${String(args.kind)}"`, 'kind is "meal" or "set".');
  },

  async add_place(ctx, args) {
    const name = String(args.name ?? '').trim();
    if (!name) return fail('A place needs a name');

    const equipment = Array.isArray(args.equipment)
      ? { available: args.equipment.map((item) => String(item)) }
      : undefined;

    // createContext refuses a duplicate name, which is the right answer: two
    // places called Berlin would make the history ambiguous.
    const contexts = await createContext(ctx, { name, equipment });
    return {
      ok: true,
      contexts,
      hint: 'Added but not switched to. Call set_context if they are there now.',
    };
  },

  async set_training_days(ctx, args) {
    const profile = await setTrainingDays(ctx, Number(args.days));
    return { ok: true, profile, today: await getToday(ctx) };
  },

  async get_program(ctx) {
    const [current, all] = await Promise.all([currentProgram(ctx), listPrograms(ctx)]);
    const program = await programWithSlots(ctx, current.id);

    return {
      ok: true,
      current: {
        name: program.name,
        mine: program.mine,
        days: program.days.map((day) => ({
          code: day.code,
          name: day.name,
          exercises: day.slots.map((slot) => ({
            name: slot.exerciseName,
            sets: slot.sets,
            repMin: slot.range.min,
            repMax: slot.range.max,
          })),
        })),
      },
      // So a switch can be offered by name without a second call.
      available: all.map((option) => ({ name: option.name, days: option.days.length })),
    };
  },

  async set_program(ctx, args) {
    const wanted = String(args.name ?? '').trim().toLowerCase();
    const all = await listPrograms(ctx);
    const match =
      all.find((option) => option.name.toLowerCase() === wanted) ??
      all.find((option) => option.name.toLowerCase().includes(wanted));

    if (!match) {
      return fail(
        `No programme called "${args.name}"`,
        `They have: ${all.map((option) => option.name).join(', ')}`,
      );
    }

    return { ok: true, program: await setProgram(ctx, match.id), today: await getToday(ctx) };
  },

  /**
   * Create or replace a programme.
   *
   * Exercise names arrive from the model, so every one is resolved against the
   * library before anything is written — a movement it invented has to fail
   * loudly here rather than become a day nobody can train.
   */
  async edit_program(ctx, args) {
    const library = await listExercises(ctx.db);
    const byName = new Map(library.map((exercise) => [exercise.name.toLowerCase(), exercise]));
    const unknown: string[] = [];

    const rawDays = Array.isArray(args.days) ? args.days : [];
    const days = rawDays.map((raw) => {
      const day = raw as Record<string, unknown>;
      const exercises = Array.isArray(day.exercises) ? day.exercises : [];

      return {
        code: typeof day.code === 'string' && day.code ? day.code : undefined,
        name: String(day.name ?? '').trim(),
        slots: exercises.flatMap((rawSlot) => {
          const slot = rawSlot as Record<string, unknown>;
          const name = String(slot.name ?? '').trim();
          const exercise =
            byName.get(name.toLowerCase()) ??
            library.find((option) => option.name.toLowerCase().includes(name.toLowerCase()));

          if (!exercise) {
            unknown.push(name);
            return [];
          }
          return [
            {
              exerciseId: exercise.id,
              sets: Number(slot.sets ?? 3),
              repMin: Number(slot.repMin ?? 6),
              repMax: Number(slot.repMax ?? 10),
            },
          ];
        }),
      };
    });

    if (unknown.length > 0) {
      return fail(
        `Not in the exercise library: ${unknown.join(', ')}`,
        'Use a name from get_today or swap_exercise. Do not invent movements.',
      );
    }

    const name = String(args.name ?? '').trim();
    const all = await listPrograms(ctx);
    const basedOn = args.basedOn
      ? all.find((option) => option.name.toLowerCase() === String(args.basedOn).toLowerCase())
      : undefined;

    // Editing means the one they own by this name; otherwise this is a new
    // programme. A built-in can only be a starting point, never a target.
    const existing = all.find(
      (option) => option.name.toLowerCase() === name.toLowerCase() && option.slug.startsWith('own_'),
    );

    const program = existing
      ? await saveProgram(ctx, existing.id, { name, days })
      : await saveProgram(
          ctx,
          (await createProgram(ctx, { name, fromProgramId: basedOn?.id ?? null })).id,
          { name, days },
        );

    return { ok: true, program, hint: 'Call set_program if they should train it now.' };
  },

  /**
   * The one handler that calls the model again inside a chat turn — the plan
   * is generated, not looked up, so the athlete waits for two model calls
   * (three if the §5 validator rejects the first plan and it is re-prompted).
   * The chat client allows two minutes, which is enough.
   *
   * It takes no arguments, and that is the whole safety property: the model
   * cannot hand it a fridge. It plans from the list the athlete confirmed with
   * their own hands, or it refuses.
   */
  async generate_meal_plan(ctx) {
    const inventory = await latestInventory(ctx);
    if (!inventory) {
      return fail(
        'No fridge list has been confirmed yet',
        'Ask them to photograph the fridge on the Fridge screen. Do not invent ingredients.',
      );
    }

    const age = inventoryAge(new Date(inventory.capturedAt), new Date());
    if (age.stale) {
      return fail(
        `The last fridge list is ${Math.round(age.hours / 24)} days old, which is too old to cook from`,
        'Ask them to photograph the fridge again. Food that was there on the day is eaten by now.',
      );
    }

    return {
      ok: true,
      plan: await generateMealPlan(ctx, inventory.items),
      fridgeList: {
        confirmedAt: inventory.capturedAt,
        place: inventory.contextName,
        ageHours: age.hours,
        mentionAge: age.worthMentioning,
      },
    };
  },
};

export async function runTool(ctx: Ctx, call: ToolCall): Promise<ToolOutcome> {
  const handler = HANDLERS[call.name];
  if (!handler) return fail(`Unknown tool "${call.name}"`);

  try {
    return await handler(ctx, call.args);
  } catch (error) {
    // A tool failure is information for the trainer, not a crashed request.
    // LlmError carries a message worth relaying — generate_meal_plan can fail
    // because the model came back malformed, and "Something went wrong" would
    // throw that away.
    const message =
      error instanceof HttpError || error instanceof LlmError
        ? error.message
        : 'Something went wrong';
    return fail(message);
  }
}
