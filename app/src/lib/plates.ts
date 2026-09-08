/**
 * What to actually put on the bar.
 *
 * The prescription says 82.5 kg. The bar says nothing. Somewhere between
 * those two is arithmetic done in a noisy room between sets, and the failure
 * mode is not a wrong answer — it is rounding to 80 because 80 is easy, week
 * after week, until the progression the app carefully computed has quietly
 * stopped happening.
 *
 * Only for barbell movements. A cable pulldown at 60 kg has a pin, not
 * plates, and offering a loading for it would be nonsense dressed as help —
 * `exercises.equipment` already says which is which.
 */

/** A standard bar. Women's bars are 15; some gyms' fixed bars differ. */
export const DEFAULT_BAR_KG = 20;

/**
 * What a commercial gym has, heaviest first. Kilograms, per side.
 *
 * 1.25 is the smallest pair worth counting on: plenty of gyms have 0.5s and
 * plenty do not, and a loading nobody can build is worse than one that comes
 * up 1 kg short and says so.
 */
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

export type Loading = {
  barKg: number;
  /** Plates for ONE side, heaviest first. */
  perSide: number[];
  /** What the bar will actually weigh once loaded. */
  achievedKg: number;
  /**
   * How far under the target the loading falls. Zero when exact.
   *
   * Reported rather than hidden: the honest answer to "load 83 kg" with 1.25s
   * as the smallest plate is 82.5 and a note, not a silent 82.5 that leaves
   * somebody believing they lifted 83.
   */
  shortByKg: number;
};

/**
 * Greedy, largest plate first, which is optimal for the plate sets real gyms
 * hold — every denomination divides the ones above it or pairs into them.
 * It is also how a person loads a bar, so the answer matches what they would
 * have done anyway, which matters more than optimality on a hypothetical set.
 */
export function loadBar(
  targetKg: number,
  barKg: number = DEFAULT_BAR_KG,
  plates: readonly number[] = DEFAULT_PLATES,
): Loading | null {
  // Below the bar there is nothing to say. This is not an error — it is a
  // dumbbell movement, or a bar somebody has mis-specified.
  if (!Number.isFinite(targetKg) || targetKg < barKg) return null;

  // Each plate goes on twice. Work in per-side kilograms throughout and the
  // halving happens once, here, rather than at four call sites.
  let remainingPerSide = (targetKg - barKg) / 2;
  const perSide: number[] = [];

  for (const plate of [...plates].sort((a, b) => b - a)) {
    // Floating point: 8.75 / 1.25 lands on 6.999999999999999 often enough to
    // matter, and the symptom is a missing smallest plate.
    while (remainingPerSide + 1e-9 >= plate) {
      perSide.push(plate);
      remainingPerSide -= plate;
    }
  }

  const achievedKg = barKg + perSide.reduce((total, plate) => total + plate, 0) * 2;

  return {
    barKg,
    perSide,
    achievedKg: round(achievedKg),
    shortByKg: round(targetKg - achievedKg),
  };
}

/** Two decimals is more than any plate needs and kills the float dust. */
const round = (value: number) => Math.round(value * 100) / 100;

/** `2 × 20, 15, 2.5` — one side, counted, for a row in the logger. */
export function describeLoading(perSide: number[]): string {
  if (perSide.length === 0) return '';

  const counts: { plate: number; count: number }[] = [];
  for (const plate of perSide) {
    const last = counts[counts.length - 1];
    if (last && last.plate === plate) last.count += 1;
    else counts.push({ plate, count: 1 });
  }

  return counts
    .map(({ plate, count }) => (count > 1 ? `${count} × ${plate}` : String(plate)))
    .join(', ');
}
