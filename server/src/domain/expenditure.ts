/**
 * What this person actually burns, measured rather than assumed.
 *
 * The calorie target comes from a formula at onboarding: a BMR estimate times
 * an activity factor. That formula has never met the athlete. It is a fine
 * place to start and a poor place to stay — two people of identical height,
 * weight, age and sex can differ by several hundred kilocalories a day, and
 * the app has been carrying the difference as an unexplained failure to lose
 * weight at the predicted rate.
 *
 * The measurement is simple arithmetic over data the app already collects:
 *
 *     expenditure = mean intake − (weight change × 7700 kcal/kg) / days
 *
 * Losing weight while eating 2400 means burning more than 2400, by exactly
 * the energy the lost tissue represented. No model is asked; none could do
 * this better than division (§1).
 *
 * ---
 *
 * The arithmetic is trivial. Everything below it is about refusing to answer
 * when the data cannot support an answer, because the failure mode here is
 * not an error message — it is telling somebody to eat less than they should.
 *
 * Two ways that happens:
 *
 *   Selective logging. Somebody who logs their disciplined days and skips the
 *   birthday cake has a mean intake far below their real one, so the estimate
 *   comes out low, and a low estimate becomes a lower target. The bias runs
 *   one way and it runs towards under-eating, which is why coverage is
 *   demanded rather than encouraged.
 *
 *   A mistyped weight. 95.3 entered as 953 moves an average enough to produce
 *   a wild number, and this figure is one people eat by. So the result is
 *   bounded by what a human body plausibly burns, and outside those bounds
 *   the answer is "no", not a clamp.
 */
import { type WeightEntry, movingAverage } from './trend';
import { KCAL_PER_KG_FAT } from './targets';
import { addDays } from './time';

/** Four weeks: long enough to average out a bad week and a salty weekend. */
export const DEFAULT_WINDOW_DAYS = 28;

/**
 * The share of days that must have food logged.
 *
 * High on purpose. At 50% coverage the mean is as much a statement about
 * which days somebody chose to log as about what they ate.
 */
const MIN_INTAKE_COVERAGE = 0.75;
/** Above this, the mean is worth calling a measurement rather than a sample. */
const GOOD_INTAKE_COVERAGE = 0.85;

/** Each endpoint average needs this many weigh-ins to be an average at all. */
const MIN_WEIGH_INS_PER_END = 3;
const GOOD_WEIGH_INS_PER_END = 5;

/**
 * What a human being plausibly burns in a day. Outside this, the inputs are
 * wrong — a typo, a duplicated import, a unit confusion — and the honest
 * answer is that the data does not support one.
 */
const PLAUSIBLE_KCAL = { min: 1000, max: 6000 };

export type IntakeDay = {
  /** YYYY-MM-DD in the athlete's own zone. */
  day: string;
  kcal: number;
};

export type Expenditure = {
  ok: true;
  /** Estimated daily energy expenditure, kcal, rounded to the nearest 10. */
  tdeeKcal: number;
  windowDays: number;
  /** Days in the window with any food logged. */
  intakeDays: number;
  meanIntakeKcal: number;
  /** Smoothed change across the window. Negative is loss. */
  changeKg: number;
  /**
   * `low` means it is a number worth showing beside a caveat, not one worth
   * changing a target on.
   */
  confidence: 'low' | 'good';
};

export type NoEstimate = {
  ok: false;
  reason: 'not_enough_intake' | 'not_enough_weight' | 'implausible';
  /** So the screen can say "19 of 28 days" rather than "not enough data". */
  intakeDays: number;
  windowDays: number;
};

export type ExpenditureResult = Expenditure | NoEstimate;

export function estimateExpenditure(
  intake: IntakeDay[],
  weights: WeightEntry[],
  asOf: string,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): ExpenditureResult {
  const from = addDays(asOf, -(windowDays - 1));

  // A day logged as zero is a day nobody ate nothing on — it is a day nobody
  // logged. Counting it would drag the mean towards fiction.
  const inWindow = intake.filter(
    (day) => day.day >= from && day.day <= asOf && day.kcal > 0,
  );
  const intakeDays = inWindow.length;
  const shortfall: Omit<NoEstimate, 'ok' | 'reason'> = { intakeDays, windowDays };

  if (intakeDays < Math.ceil(windowDays * MIN_INTAKE_COVERAGE)) {
    return { ok: false, reason: 'not_enough_intake', ...shortfall };
  }

  // Endpoints are smoothed, never raw: day-to-day weight is water and salt,
  // and a single Saturday would otherwise set the whole estimate.
  const end = movingAverage(weights, asOf);
  const start = movingAverage(weights, addDays(asOf, -windowDays));

  if (
    !end ||
    !start ||
    end.sampleCount < MIN_WEIGH_INS_PER_END ||
    start.sampleCount < MIN_WEIGH_INS_PER_END
  ) {
    return { ok: false, reason: 'not_enough_weight', ...shortfall };
  }

  const meanIntakeKcal = inWindow.reduce((total, day) => total + day.kcal, 0) / intakeDays;
  const changeKg = end.avgKg - start.avgKg;

  // Losing weight means burning more than was eaten, by exactly the energy the
  // lost tissue held. Gaining is the same sum with the sign the other way.
  const dailyBalance = (changeKg * KCAL_PER_KG_FAT) / windowDays;
  const tdee = meanIntakeKcal - dailyBalance;

  if (tdee < PLAUSIBLE_KCAL.min || tdee > PLAUSIBLE_KCAL.max) {
    return { ok: false, reason: 'implausible', ...shortfall };
  }

  const coverage = intakeDays / windowDays;
  const confidence =
    coverage >= GOOD_INTAKE_COVERAGE &&
    end.sampleCount >= GOOD_WEIGH_INS_PER_END &&
    start.sampleCount >= GOOD_WEIGH_INS_PER_END
      ? 'good'
      : 'low';

  return {
    ok: true,
    // To the nearest ten. The inputs do not support a units digit, and
    // printing one claims a precision this does not have.
    tdeeKcal: Math.round(tdee / 10) * 10,
    windowDays,
    intakeDays,
    meanIntakeKcal: Math.round(meanIntakeKcal),
    changeKg,
    confidence,
  };
}
