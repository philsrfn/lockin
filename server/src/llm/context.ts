/**
 * Context assembly, per §10. Built fresh per request and kept under ~3k tokens.
 *
 * The point is that the trainer never has to ask a question the database can
 * already answer. It knows where he is, what he lifted last week, what he
 * weighs, and what he has eaten today before it says a word.
 */
import { remaining } from '../domain/macros';
import { movingAverage, weeklyChangeKg } from '../domain/trend';
import { WEEKLY_TARGETS } from '../domain/program';
import { jointPainGate, rampIn } from '../domain/progression';
import { listEntries } from '../services/bodyweight';
import { recentCardio } from '../services/cardio';
import { activeContext } from '../services/contexts';
import { recoverySignals } from '../services/health';
import { macrosToday, mealsToday } from '../services/meals';
import { getProfile, macroTargets } from '../services/profile';
import { listRules } from '../services/rules';
import { firstSessionAt, recentSessions } from '../services/sessions';
import { planFor, upcomingTemplate } from '../services/workouts';
import { openSession } from '../services/sessions';
import { getWeek } from '../services/week';
import { activeRulesFor } from '../rules/schema';
import { dayIn } from '../domain/time';
import { languageInstruction } from '../domain/language';
import type { Ctx } from '../db';

const kg = (value: number | null | undefined, dp = 1) =>
  value == null ? 'unknown' : value.toFixed(dp).replace(/\.0$/, '');

/**
 * What equipment this place has, in the athlete's own words. It used to read
 * "Hansefit BEST — unlimited nationwide check-ins" for anybody with a gym,
 * which is Phil's membership and nobody else's.
 */
function gymLine(context: { equipment?: Record<string, unknown> } | null): string {
  const equipment = context?.equipment ?? {};
  if (!equipment.gym) return 'none';
  const notes = typeof equipment.notes === 'string' ? equipment.notes.trim() : '';
  return notes ? `yes — ${notes}` : 'yes';
}

/** Assembles the ATHLETE / CONTEXT / RULES / RECENT / TODAY blocks of §10. */
export async function assembleContext(ctx: Ctx): Promise<string> {
  // His zone decides what "today" and "the last 14 days" mean in every line
  // below, so it is resolved before anything is read.
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const asOf = dayIn(zone);

  const [context, rules, sessions, entries, meals, consumed, firstAt, open, week, cardio, recovery] =
    await Promise.all([
      activeContext(ctx),
      listRules(ctx),
      recentSessions(ctx, 14),
      listEntries(ctx, 28, zone),
      mealsToday(ctx, zone),
      macrosToday(ctx, zone),
      firstSessionAt(ctx),
      openSession(ctx),
      getWeek(ctx),
      recentCardio(ctx, 14),
      recoverySignals(ctx, zone),
    ]);

  const average7 = movingAverage(entries, asOf);
  const changeKg = weeklyChangeKg(entries, asOf);
  const targets = macroTargets(profile);
  const left = remaining(targets, consumed);

  const finished = sessions
    .filter((session) => session.rpe !== null)
    .map((session) => ({ performedAt: new Date(session.performedAt), jointPain: session.jointPain }));
  const gate = jointPainGate(finished);
  const ramp = rampIn(firstAt, new Date());

  const template = open?.template ?? (await upcomingTemplate(ctx));
  const plan = await planFor(ctx, template, { excludeSessionId: open?.id });

  const scoped = activeRulesFor(rules, context?.name ?? null);
  const byTier = (tier: string) =>
    scoped.filter((rule) => rule.tier === tier).map((rule) => `- ${rule.text}`).join('\n') || '- none';

  // Read rather than asked about. Resting heart rate drifting up over a block
  // is the signal that arrives before he feels it.
  const recoveryLines = [
    recovery.avgSteps == null
      ? '- steps: not shared'
      : `- steps: ${recovery.avgSteps}/day average over ${recovery.daysWithSteps} day(s), target ${WEEKLY_TARGETS.stepsPerDay}`,
    recovery.lastNightSleepMinutes == null
      ? '- sleep: not shared'
      : `- sleep last night: ${Math.floor(recovery.lastNightSleepMinutes / 60)}h${String(recovery.lastNightSleepMinutes % 60).padStart(2, '0')}`,
    recovery.restingHr == null
      ? '- resting heart rate: not shared'
      : `- resting heart rate: ${recovery.restingHr}${
          recovery.restingHrTrend == null
            ? ''
            : ` (${recovery.restingHrTrend >= 0 ? '+' : ''}${recovery.restingHrTrend} vs the fortnight before${
                recovery.restingHrTrend >= 3 ? ' — that is a real rise, ask how he feels' : ''
              })`
        }`,
  ].join('\n');

  const cardioLines =
    cardio.length === 0
      ? '- none logged'
      : cardio
          .slice(0, 8)
          .map(
            (entry) =>
              `- ${dayIn(zone, new Date(entry.performedAt))}: ${entry.kind} ${entry.minutes}min` +
              `${entry.description ? ` (${entry.description})` : ''}` +
              `${entry.counts ? '' : ' [does not count towards the week]'}`,
          )
          .join('\n');

  const recentLines =
    sessions.length === 0
      ? '- no sessions logged yet'
      : sessions
          .slice(0, 8)
          .map((session) => {
            // His date, not the UTC one an ISO string would slice to.
            const date = dayIn(zone, new Date(session.performedAt));
            const top = session.sets
              .reduce<Record<string, { weightKg: number; reps: number }>>((best, set) => {
                const current = best[set.exerciseName];
                if (!current || set.weightKg > current.weightKg) {
                  best[set.exerciseName] = { weightKg: set.weightKg, reps: set.reps };
                }
                return best;
              }, {});
            const tops = Object.entries(top)
              .map(([name, set]) => `${name} ${kg(set.weightKg)}×${set.reps}`)
              .join(', ');
            const flags = [
              session.rpe ? `RPE ${session.rpe}` : 'not finished',
              session.jointPain ? 'JOINT PAIN' : null,
              session.notes ? `"${session.notes}"` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return `- ${date} day ${session.template ?? '?'}: ${tops || 'no sets'} (${flags})`;
          })
          .join('\n');

  const mealLines =
    meals.length === 0
      ? '- nothing logged today'
      : meals
          .map((meal) => `- ${meal.slot}: ${meal.description} (${meal.kcal ?? '?'} kcal, ${meal.proteinG ?? '?'}g protein)`)
          .join('\n');

  const strengthThisWeek = sessions.filter(
    (session) =>
      session.template !== null &&
      new Date(session.performedAt).getTime() > Date.now() - 7 * 86_400_000,
  ).length;

  return `LANGUAGE
${languageInstruction(profile.locale)}

ATHLETE
- ${profile.heightCm}cm, goal ${kg(profile.goalWeightKg, 0)}kg
- latest weigh-in: ${entries.length ? `${kg(entries[entries.length - 1]!.weightKg)}kg` : 'none yet'}
- 7-day average: ${average7 ? `${kg(average7.avgKg)}kg from ${average7.sampleCount}/7 days` : 'not enough weigh-ins'}
- week-over-week: ${changeKg == null ? 'not enough data' : `${changeKg > 0 ? '+' : '−'}${kg(Math.abs(changeKg))}kg`}
- targets: ${targets.kcal} kcal, ${targets.proteinG}g protein, ${targets.fatFloorG}g fat floor

CURRENT CONTEXT
- city: ${context?.name ?? 'unset'}
- gym: ${gymLine(context)}
- dinner profile: ${(context?.foodProfile as { dinner?: string })?.dinner ?? 'own'}

RULES (filtered to this city)
hard:
${byTier('hard')}
never:
${byTier('never')}
soft:
${byTier('soft')}

TRAINING STATE
- ramp-in: ${ramp.active ? `ACTIVE — cap ${ramp.maxWorkingSets} working sets, keep ${ramp.minRir}+ reps in reserve` : 'over'}
- joint pain: ${gate.consecutiveFlags} consecutive flagged session(s)${gate.recommendDoctor ? ' — LOAD CUT AND HE MUST SEE A DOCTOR' : gate.holdLoad ? ' — hold load, do not add weight' : ''}
- this week: ${strengthThisWeek} of ${WEEKLY_TARGETS.strengthSessions} strength sessions, ${week.cardio.done} of ${week.cardio.target} cardio sessions (${week.cardio.minutes} min logged)

RECENT (last 14 days)
${recentLines}

CARDIO (last 14 days)
${cardioLines}

RECOVERY
${recoveryLines}

TODAY (${asOf})
- session in progress: ${open ? `yes, day ${open.template}, ${open.sets.length} sets logged` : 'no'}
- next session would be day ${plan.template}:
${plan.exercises.map((e) => `  - ${e.name} ${e.sets}×${e.targetReps}${e.weightKg == null ? ' (no history — he picks the weight)' : ` @ ${kg(e.weightKg)}kg`} [${e.reason}]`).join('\n')}
- eaten today:
${mealLines}
- remaining: ${left.kcal} kcal, ${left.proteinG}g protein, ${left.fatToFloorG}g to the fat floor`;
}
