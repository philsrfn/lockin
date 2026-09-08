import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_DAYS, estimateExpenditure } from '../expenditure';
import { KCAL_PER_KG_FAT } from '../targets';
import { addDays } from '../time';

const AS_OF = '2026-09-04';

/** `days` consecutive days of the same intake, ending on asOf. */
const intakeFor = (days: number, kcal: number, endingOn = AS_OF) =>
  Array.from({ length: days }, (_, i) => ({ day: addDays(endingOn, -i), kcal }));

/**
 * A weigh-in every day, changing at a constant rate, ending at `endKg` today.
 *
 * Linear on purpose: the estimate smooths both endpoints over seven days, and
 * on a straight line a moving average sits exactly on the midpoint — so the
 * measured change across the window is exactly `changeKg`, and the expected
 * answer can be written down rather than approximated.
 *
 * The series runs a fortnight past the window because the opening average
 * looks back seven days before the window even starts.
 */
function weighIns(endKg: number, changeKg: number, windowDays = DEFAULT_WINDOW_DAYS) {
  const perDay = changeKg / windowDays;
  const span = windowDays + 14;
  return Array.from({ length: span + 1 }, (_, i) => ({
    measuredOn: addDays(AS_OF, -i),
    weightKg: endKg - perDay * i,
  }));
}

/** What the arithmetic must come out at, written out rather than reimplemented. */
const expectedTdee = (meanIntake: number, changeKg: number, windowDays = DEFAULT_WINDOW_DAYS) =>
  meanIntake - (changeKg * KCAL_PER_KG_FAT) / windowDays;

describe('measuring what somebody actually burns', () => {
  it('adds back the energy the lost weight represented', () => {
    // Ate 2400 a day and lost 2 kg over four weeks. The missing energy came
    // from somewhere: 2 kg × 7700 / 28 days = 550 kcal a day above intake.
    const result = estimateExpenditure(
      intakeFor(28, 2400),
      weighIns(95, -2),
      AS_OF,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changeKg).toBeCloseTo(-2, 6);
    expect(result.tdeeKcal).toBe(Math.round(expectedTdee(2400, -2) / 10) * 10);
  });

  it('subtracts the energy that gained weight represents', () => {
    const result = estimateExpenditure(intakeFor(28, 3200), weighIns(81, +1), AS_OF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tdeeKcal).toBeLessThan(3200);
  });

  it('reads a flat month as eating exactly maintenance', () => {
    const result = estimateExpenditure(intakeFor(28, 2650), weighIns(90, 0), AS_OF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tdeeKcal).toBe(2650);
  });

  it('rounds to the nearest ten, because the inputs have no units digit', () => {
    const result = estimateExpenditure(intakeFor(28, 2437), weighIns(90, 0), AS_OF);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tdeeKcal % 10).toBe(0);
  });
});

describe('refusing to answer', () => {
  it('will not average a month somebody only logged half of', () => {
    // The bias runs one way: people log their disciplined days. A mean built
    // from those is low, and a low estimate becomes a lower target.
    const result = estimateExpenditure(intakeFor(14, 2400), weighIns(95, -2), AS_OF);

    expect(result).toMatchObject({ ok: false, reason: 'not_enough_intake', intakeDays: 14 });
  });

  it('counts a zero-kcal day as unlogged, not as a fast', () => {
    const half = intakeFor(28, 2400).map((day, i) => (i % 2 ? { ...day, kcal: 0 } : day));

    expect(estimateExpenditure(half, weighIns(95, -2), AS_OF)).toMatchObject({
      ok: false,
      reason: 'not_enough_intake',
    });
  });

  it('needs weigh-ins at both ends, not just recently', () => {
    // Started weighing in a fortnight ago: there is no opening average to
    // measure the change from.
    const recent = weighIns(95, -2).slice(-14);

    expect(estimateExpenditure(intakeFor(28, 2400), recent, AS_OF)).toMatchObject({
      ok: false,
      reason: 'not_enough_weight',
    });
  });

  it('refuses a mistyped weight rather than clamping it', () => {
    // 95.3 entered as 953. Clamping would hand back a plausible-looking number
    // built from nonsense, and this figure is one people eat by.
    const typo = [
      ...weighIns(95, -2),
      { measuredOn: AS_OF, weightKg: 953 },
      { measuredOn: addDays(AS_OF, -1), weightKg: 953 },
      { measuredOn: addDays(AS_OF, -2), weightKg: 953 },
    ];

    expect(estimateExpenditure(intakeFor(28, 2400), typo, AS_OF)).toMatchObject({
      ok: false,
      reason: 'implausible',
    });
  });

  it('says how far short the data fell, so the screen can be specific', () => {
    const result = estimateExpenditure(intakeFor(10, 2400), weighIns(95, -2), AS_OF);

    expect(result).toMatchObject({ intakeDays: 10, windowDays: 28 });
  });
});

describe('how much to trust it', () => {
  it('is good when nearly every day is logged and weighed', () => {
    const result = estimateExpenditure(intakeFor(28, 2400), weighIns(95, -2), AS_OF);

    expect(result.ok && result.confidence).toBe('good');
  });

  it('is low when the coverage only just clears the bar', () => {
    // 21 of 28 days logged: enough to answer, not enough to act on.
    const result = estimateExpenditure(intakeFor(21, 2400), weighIns(95, -2), AS_OF);

    expect(result.ok && result.confidence).toBe('low');
  });

  it('is low when the weigh-ins are sparse at either end', () => {
    // Every other day: four per seven-day window. Enough to average, not
    // enough to call the average settled.
    const sparse = weighIns(95, -2).filter((_, i) => i % 2 === 0);
    const result = estimateExpenditure(intakeFor(28, 2400), sparse, AS_OF);

    expect(result.ok && result.confidence).toBe('low');
  });

  it('refuses outright when the weigh-ins are sparser still', () => {
    // Every fifth day is one or two per window. That is not an average.
    const rare = weighIns(95, -2).filter((_, i) => i % 5 === 0);

    expect(estimateExpenditure(intakeFor(28, 2400), rare, AS_OF)).toMatchObject({
      ok: false,
      reason: 'not_enough_weight',
    });
  });
});
