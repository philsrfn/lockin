/**
 * What today's cardio is worth in food.
 *
 * The ask, from somebody using the app: cardio has no effect. He runs, and the
 * number that says how much is left to eat does not move. That is true, and
 * the reason is worth writing down because it decides the shape of the answer.
 *
 * `domain/targets.ts` computes maintenance as BMR × activity factor, plus a
 * flat `trainingDaysPerWeek × 350 / 7` smeared across every day of the week.
 * So training is already in the target — just averaged, so that a Tuesday run
 * and a Wednesday rest day look identical. What is missing is not the
 * calories. It is the day they happened on.
 *
 * Which means the credit cannot simply be "what the session burned": some of
 * that is already in the target, and adding it again is how an app tells
 * somebody to eat twice for one run.
 *
 * THREE CORRECTIONS, ALL DOWNWARD
 *
 * **Net, not gross.** MET tables are gross: 8 METs includes the metabolism you
 * would have run sitting still, and that is already in BMR. Net is
 * `(MET − 1) × kg × hours`. For 45 minutes of zone 2 at 95 kg that is the
 * difference between 570 and 499 kcal — one of which is food you did not earn.
 *
 * **Minus what the target already assumed.** The flat weekly training
 * allowance is subtracted once per day, so a session on a day the target
 * already expected to be a training day credits only its excess.
 *
 * **Capped.** MET values are population averages and the error grows with
 * duration. Crediting 2000 kcal off a three-hour estimate is not generosity,
 * it is invention, and the person eating it finds out four weeks later when
 * the trend has not moved.
 *
 * All three err towards under-crediting, deliberately. Too little means a
 * deficit slightly deeper than intended, which somebody notices as being
 * hungry. Too much means a stall they cannot explain and an app they stop
 * trusting.
 *
 * Off by default. It is a setting because it is a preference — some people
 * want the number to hold still.
 */

/**
 * Metabolic equivalents, from the Compendium of Physical Activities. Rounded,
 * because the fourth significant figure of a population average applied to one
 * person is decoration.
 */
const MET: Record<string, number> = {
  zone2: 7,
  intervals: 9,
  sport: 8,
  walk: 3.5,
  other: 5,
};

/** Anything unknown is treated as light. Guessing upward invents food. */
const UNKNOWN_MET = 4;

/**
 * The most a day of cardio may add.
 *
 * Not a safety floor — eating more is the safe direction — but a limit on how
 * far an estimate is allowed to be trusted. Past a thousand calories the MET
 * model is describing somebody else.
 */
export const MAX_DAILY_CREDIT_KCAL = 1000;

/** Gross minus what sitting still would have cost anyway. */
export function netBurnKcal(
  session: { kind: string; minutes: number },
  weightKg: number,
): number {
  const met = MET[session.kind] ?? UNKNOWN_MET;
  const hours = Math.max(0, session.minutes) / 60;
  return Math.max(0, Math.round((met - 1) * weightKg * hours));
}

/**
 * What today's cardio adds to today's calorie target.
 *
 * `dailyTrainingAllowanceKcal` is what `maintenanceKcal` already added for
 * this athlete, per day — see `domain/targets.ts`. Subtracted once rather than
 * per session: a day with a lift and a run has one day's worth of allowance in
 * it, not two.
 *
 * Zero when the weight is unknown, because every number here scales with it
 * and a guessed body is a guessed meal.
 */
export function cardioCreditKcal(
  sessions: readonly { kind: string; minutes: number }[],
  weightKg: number | null,
  dailyTrainingAllowanceKcal: number,
): number {
  if (weightKg == null || weightKg <= 0) return 0;

  const burned = sessions.reduce((sum, session) => sum + netBurnKcal(session, weightKg), 0);
  const beyondWhatWasAssumed = burned - Math.max(0, dailyTrainingAllowanceKcal);

  return Math.min(MAX_DAILY_CREDIT_KCAL, Math.max(0, Math.round(beyondWhatWasAssumed)));
}
