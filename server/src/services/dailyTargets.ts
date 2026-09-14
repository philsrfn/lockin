/**
 * What to eat today, which is not always what to eat on an average day.
 *
 * `macroTargets(profile)` is the flat number the questionnaire computed, and
 * it is right for a week. It is not right for a Tuesday somebody ran ten
 * kilometres on, and that was the complaint: cardio has no effect.
 *
 * One place, because there are three readers — the home screen, the trainer's
 * context, and the meal planner — and a day where the app says 2300 on one
 * screen and 2578 on another is worse than one that never moved at all.
 */
import type { Ctx } from '../db';
import { type MacroTargets } from '../domain/macros';
import { cardioCreditKcal } from '../domain/cardioBurn';
import { dailyTrainingAllowanceKcal } from '../domain/targets';
import { cardioToday } from './cardio';
import { type Profile, macroTargets } from './profile';

export type TodaysTargets = MacroTargets & {
  /**
   * What cardio added, and zero when it added nothing — including when the
   * setting is off. Carried separately so a screen can say where the number
   * came from rather than quietly showing a different one.
   */
  cardioCreditKcal: number;
};

export async function todaysTargets(
  ctx: Ctx,
  profile: Profile,
  zone: string,
): Promise<TodaysTargets> {
  const base = macroTargets(profile);
  if (!profile.cardioAddsCalories) return { ...base, cardioCreditKcal: 0 };

  const [sessions, weight] = await Promise.all([
    cardioToday(ctx, zone),
    latestWeightKg(ctx),
  ]);

  const credit = cardioCreditKcal(
    sessions,
    weight,
    dailyTrainingAllowanceKcal(profile.trainingDaysPerWeek),
  );

  return { ...base, kcal: base.kcal + credit, cardioCreditKcal: credit };
}

/**
 * The most recent weigh-in, because every number in the burn scales with it.
 * Not the goal weight and not the onboarding weight: what they weigh now.
 */
async function latestWeightKg(ctx: Ctx): Promise<number | null> {
  const { rows } = await ctx.db.query<{ weight_kg: number }>(
    'select weight_kg from bodyweight where user_id = $1 order by measured_on desc limit 1',
    [ctx.userId],
  );
  return rows[0]?.weight_kg ?? null;
}
