import { type Queryable, pool } from '../db';
import { type Macros, type RemainingMacros, remaining } from '../domain/macros';
import { WEEKLY_TARGETS } from '../domain/templates';
import { type Context, activeContext } from './contexts';
import { type Profile, getProfile, macroTargets } from './profile';
import { type Session, openSession, recentSessions, sessionsToday } from './sessions';
import { type WeightSummary, summary as weightSummary, today as todayDate } from './bodyweight';
import { type Meal, macrosToday, mealsToday } from './meals';
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
  week: {
    strengthSessions: { done: number; target: number };
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
export async function getToday(db: Queryable = pool): Promise<Today> {
  const [profile, context, open, weight, consumed, lastWeek, coach, meals, todaySessions] =
    await Promise.all([
    getProfile(db),
    activeContext(db),
    openSession(db),
    weightSummary(30, db),
    macrosToday(db),
    recentSessions(7, db),
    // Read-only: whatever was generated earlier. Never generates here.
    cachedNote(todayDate(), db),
    mealsToday(db),
    sessionsToday(db),
  ]);

  // Mid-workout, today's plan is the session he is already in — and it must not
  // count its own sets as history when prescribing the next load.
  const template = open?.template ?? (await upcomingTemplate(db));
  const plan = await planFor(template, { excludeSessionId: open?.id }, db);

  const targets = macroTargets(profile);

  return {
    date: todayDate(),
    profile,
    context,
    openSession: open,
    completedToday: todaySessions.filter((session) => session.finished),
    plan,
    weight,
    macros: { targets, consumed, remaining: remaining(targets, consumed), meals },
    week: {
      strengthSessions: {
        done: lastWeek.filter((session) => session.template !== null).length,
        target: WEEKLY_TARGETS.strengthSessions,
      },
    },
    coach,
  };
}
