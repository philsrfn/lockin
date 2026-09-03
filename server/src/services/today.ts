import type { Ctx } from '../db';
import { type Macros, type RemainingMacros, remaining } from '../domain/macros';
import { WEEKLY_TARGETS } from '../domain/program';
import { type Context, activeContext } from './contexts';
import { type Profile, getProfile, macroTargets } from './profile';
import { type Session, openSession, recentSessions, sessionsToday } from './sessions';
import { type WeightSummary, summary as weightSummary } from './bodyweight';
import { dayIn } from '../domain/time';
import { type CardioSession, cardioToday } from './cardio';
import { ensureDeload } from './deloads';
import { type DailyHealth, healthToday } from './health';
import { type Meal, macrosToday, mealsToday } from './meals';
import { getWeek } from './week';
import { type WorkoutPlan, planFor, upcomingTemplate } from './workouts';
import { type CoachNote, cachedNote } from '../llm/coach';

export type Today = {
  date: string;
  profile: Profile;
  context: Context | null;
  /** The session in progress, if he is mid-workout. */
  openSession: Session | null;
  /** Finished today. Added phase 4 so Today stops offering a workout he has done. */
  completedToday: Session[];
  plan: WorkoutPlan;
  weight: WeightSummary;
  macros: {
    targets: ReturnType<typeof macroTargets>;
    consumed: Macros;
    remaining: RemainingMacros;
    /** What he has actually logged today. Added in phase 4. */
    meals: Meal[];
  };
  /** Cardio logged today. The screen stops offering what he has already done. */
  cardioToday: CardioSession[];
  /** Steps, sleep and resting heart rate, when the phone has synced. */
  health: DailyHealth | null;
  week: {
    strengthSessions: { done: number; target: number };
    cardioSessions: { done: number; target: number; minutes: number };
    steps: { average: number | null; target: number; daysKnown: number };
  };
  /**
   * The trainer's read on today. null when it has not been generated yet —
   * the screen renders the deterministic plan immediately and fills this in
   * behind it, so a slow model call never blocks the app.
   */
  coach: CoachNote | null;
};

/**
 * Everything the Today screen needs, in one round trip. On a bad gym wifi
 * connection two requests are twice the chance of neither arriving.
 */
export async function getToday(ctx: Ctx): Promise<Today> {
  // Resolved once and handed down, so every part of this payload agrees about
  // which day it is — and so the ten reads below do not each look it up again.
  const profile = await getProfile(ctx);
  const zone = profile.timezone;
  const today = dayIn(zone);

  const [
    context,
    open,
    weight,
    consumed,
    lastWeek,
    coach,
    meals,
    todaySessions,
    week,
    cardio,
    health,
  ] = await Promise.all([
    activeContext(ctx),
    openSession(ctx),
    weightSummary(ctx, 30, zone),
    macrosToday(ctx, zone),
    recentSessions(ctx, 7),
    // Read-only: whatever was generated earlier. Never generates here.
    cachedNote(ctx, today),
    mealsToday(ctx, zone),
    sessionsToday(ctx, zone),
    getWeek(ctx),
    cardioToday(ctx, zone),
    healthToday(ctx, zone),
  ]);

  // Recorded here rather than by a job: this payload is fetched every time he
  // opens the app, so a light week starts at the start of the week.
  await ensureDeload(ctx, zone);

  // The one request every launch makes, so it is where "still here" is
  // recorded. Throttled to an hour: this is a read path, and the value is only
  // ever compared in days.
  await ctx.db.query(
    `update profile set last_seen_at = now()
     where user_id = $1
       and (last_seen_at is null or last_seen_at < now() - interval '1 hour')`,
    [ctx.userId],
  );

  // Mid-workout, today's plan is the session he is already in — and it must not
  // count its own sets as history when prescribing the next load.
  const template = open?.template ?? (await upcomingTemplate(ctx));
  const plan = await planFor(ctx, template, { excludeSessionId: open?.id });

  const targets = macroTargets(profile);

  return {
    date: today,
    profile,
    context,
    openSession: open,
    completedToday: todaySessions.filter((session) => session.finished),
    plan,
    weight,
    macros: { targets, consumed, remaining: remaining(targets, consumed), meals },
    cardioToday: cardio,
    health,
    week: {
      // Same source as the week strip, so the two can never disagree.
      strengthSessions: {
        done: week.strength.done,
        target: WEEKLY_TARGETS.strengthSessions,
      },
      cardioSessions: week.cardio,
      steps: week.steps,
    },
    coach,
  };
}
