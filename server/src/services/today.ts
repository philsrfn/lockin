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
import { type WorkoutPlan, planFor, templateForToday } from './workouts';
import { type CoachNote, cachedNote } from '../llm/coach';
import { noteStillFits } from '../domain/coachNote';

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
   * The first day this athlete has anything logged on, in their zone. The
   * home screen scrolls back through weeks and there is no point offering
   * fifteen empty ones to somebody who started on Tuesday. Null when they
   * have logged nothing at all.
   */
  since: string | null;
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
    since,
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
    firstLoggedDay(ctx, zone),
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
  const template = await templateForToday(ctx, open?.template ?? null);
  const plan = await planFor(ctx, template, { excludeSessionId: open?.id });

  const targets = macroTargets(profile);

  /**
   * A note that no longer describes today is dropped rather than shown.
   *
   * This path deliberately never generates one — a model call on every app
   * open is the thing the cache exists to prevent — so the only two answers
   * available here are "show the morning's note" and "show none". Since
   * programmes became something an athlete edits, the morning's note can name
   * a day the plan below it no longer has, and the card and the plan then
   * disagree on the one thing the screen is for. No read is honest; the wrong
   * read is not. The next generation writes a fresh one.
   */
  let stillToday: CoachNote | null = null;
  if (
    coach &&
    noteStillFits(
      { template: coach.template, contextName: coach.forContext },
      { contextName: context?.name ?? null, dayCodes: plan.days.map((day) => day.code) },
    )
  ) {
    // `forContext` is how the note is checked, not something to show — the
    // screen already names the place in its own chip.
    const { forContext: _written, ...note } = coach;
    stillToday = note;
  }

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
    coach: stillToday,
    since,
  };
}

/**
 * The earliest day with anything on it — a session, a weigh-in or a meal.
 *
 * Not the account's creation date: this database predates the users table, and
 * an athlete who imported history would have data older than their row.
 */
async function firstLoggedDay(ctx: Ctx, zone: string): Promise<string | null> {
  const { rows } = await ctx.db.query<{ day: string | null }>(
    `select to_char(min(day), 'YYYY-MM-DD') as day from (
       select min(performed_at at time zone $2)::date as day
         from sessions where user_id = $1
       union all
       select min(measured_on) from bodyweight where user_id = $1
       union all
       select min(eaten_at at time zone $2)::date from meals where user_id = $1
     ) as first_days`,
    [ctx.userId, zone],
  );

  return rows[0]?.day ?? null;
}
