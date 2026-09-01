/**
 * Macro arithmetic. Pure, and the only place calories are ever computed.
 *
 * Precision on vegetables is not required (§11). Everything rounds to whole
 * calories and whole grams, because that is the resolution he actually logs at.
 */

export const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

export type Macros = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
};

/** A logged item, where anything unknown is simply absent. */
export type MacroInput = Partial<Macros>;

export type MacroTargets = {
  kcal: number;
  proteinG: number;
  fatFloorG: number;
};

export const ZERO_MACROS: Macros = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };

export function kcalFromMacros(macros: Omit<MacroInput, 'kcal'>): number {
  return Math.round(
    (macros.proteinG ?? 0) * KCAL_PER_G.protein +
      (macros.fatG ?? 0) * KCAL_PER_G.fat +
      (macros.carbsG ?? 0) * KCAL_PER_G.carbs,
  );
}

export function sumMacros(entries: MacroInput[]): Macros {
  let kcal = 0;
  let proteinG = 0;
  let fatG = 0;
  let carbsG = 0;

  for (const entry of entries) {
    kcal += entry.kcal ?? 0;
    proteinG += entry.proteinG ?? 0;
    fatG += entry.fatG ?? 0;
    carbsG += entry.carbsG ?? 0;
  }

  // Round once, at the end. Rounding per entry drifts over a day of logging.
  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
  };
}

export type RemainingMacros = {
  /** Negative once he is over. An overshoot he cannot see is an overshoot he repeats. */
  kcal: number;
  proteinG: number;
  /** How much fat is still needed to clear the floor. Never negative. */
  fatToFloorG: number;
  kcalPct: number;
  proteinPct: number;
};

function percentOf(value: number, target: number): number {
  return target <= 0 ? 0 : Math.round((value / target) * 100);
}

export function remaining(targets: MacroTargets, consumed: Macros): RemainingMacros {
  return {
    kcal: Math.round(targets.kcal - consumed.kcal),
    proteinG: Math.round(targets.proteinG - consumed.proteinG),
    fatToFloorG: Math.max(0, Math.round(targets.fatFloorG - consumed.fatG)),
    kcalPct: percentOf(consumed.kcal, targets.kcal),
    proteinPct: percentOf(consumed.proteinG, targets.proteinG),
  };
}

/** Half a portion of mom's food is a hard rule, so halving is domain logic. */
export function scaleMacros(macros: Macros, factor: number): Macros {
  return {
    kcal: Math.round(macros.kcal * factor),
    proteinG: Math.round(macros.proteinG * factor),
    fatG: Math.round(macros.fatG * factor),
    carbsG: Math.round(macros.carbsG * factor),
  };
}
