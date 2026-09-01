import { type Queryable, pool } from '../db';
import { type Macros, type RemainingMacros, remaining, sumMacros } from '../domain/macros';
import { WEEKLY_TARGETS } from '../domain/templates';
import { type Context, activeContext } from './contexts';
import { type Profile, getProfile, macroTargets } from './profile';
import { type Session, openSession, recentSessions } from './sessions';
import { type WeightSummary, summary as weightSummary, today as todayDate } from './bodyweight';
import { type WorkoutPlan, planFor, upcomingTemplate } from './workouts';

export type Today = {
  date: string;
  profile: Profile;
  context: Context | null;
  /** The session in progress, if he is mid-workout. */
  openSession: Session | null;
  plan: WorkoutPlan;
  weight: WeightSummary;
  macros: {
    targets: ReturnType<typeof macroTargets>;
    consumed: Macros;
    remaining: RemainingMacros;
  };
  week: {
    strengthSessions: { done: number; target: number };
  };
};

/** Meals logged today. Phase 4 fills this table; the arithmetic is ready now. */
async function macrosToday(db: Queryable): Promise<Macros> {
  const { rows } = await db.query<{ kcal: number | null; protein_g: number | null }>(
    `select kcal, protein_g from meals where eaten_at::date = current_date`,
  );
  return sumMacros(
    rows.map((row) => ({ kcal: row.kcal ?? 0, proteinG: row.protein_g ?? 0 })),
  );
}

/**
 * Everything the Today screen needs, in one round trip. On a bad gym wifi
 * connection two requests are twice the chance of neither arriving.
 */
export async function getToday(db: Queryable = pool): Promise<Today> {
  const [profile, context, open, weight, consumed, lastWeek] = await Promise.all([
    getProfile(db),
    activeContext(db),
    openSession(db),
    weightSummary(30, db),
    macrosToday(db),
    recentSessions(7, db),
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
    plan,
    weight,
    macros: { targets, consumed, remaining: remaining(targets, consumed) },
    week: {
      strengthSessions: {
        done: lastWeek.filter((session) => session.template !== null).length,
        target: WEEKLY_TARGETS.strengthSessions,
      },
    },
  };
}
