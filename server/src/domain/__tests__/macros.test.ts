import { describe, expect, it } from 'vitest';
import { type MacroTargets, kcalFromMacros, remaining, scaleMacros, sumMacros } from '../macros';

const TARGETS: MacroTargets = { kcal: 2300, proteinG: 190, fatFloorG: 70 };

describe('kcalFromMacros', () => {
  it('uses 4 / 9 / 4', () => {
    expect(kcalFromMacros({ proteinG: 190, fatG: 70, carbsG: 200 })).toBe(2190);
  });

  it('treats missing macros as zero', () => {
    expect(kcalFromMacros({ proteinG: 40 })).toBe(160);
    expect(kcalFromMacros({})).toBe(0);
  });

  it('rounds to whole calories', () => {
    expect(kcalFromMacros({ proteinG: 12.5, fatG: 3.3, carbsG: 0 })).toBe(80); // 50 + 29.7
  });
});

describe('sumMacros', () => {
  it('is zero for an empty day', () => {
    expect(sumMacros([])).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  });

  it('adds entries and treats absent fields as zero', () => {
    const total = sumMacros([
      { kcal: 520, proteinG: 48, fatG: 6, carbsG: 62 }, // skyr breakfast
      { kcal: 640, proteinG: 45 },
      { proteinG: 22 },
    ]);
    expect(total).toEqual({ kcal: 1160, proteinG: 115, fatG: 6, carbsG: 62 });
  });

  it('rounds once at the end rather than per entry', () => {
    const total = sumMacros([{ proteinG: 0.4 }, { proteinG: 0.4 }, { proteinG: 0.4 }]);
    expect(total.proteinG).toBe(1);
  });
});

describe('remaining', () => {
  it('reports what is left of the day', () => {
    const left = remaining(TARGETS, { kcal: 1200, proteinG: 110, fatG: 40, carbsG: 100 });
    expect(left.kcal).toBe(1100);
    expect(left.proteinG).toBe(80);
    expect(left.fatToFloorG).toBe(30);
  });

  it('goes negative on calories so an overshoot is visible, not hidden', () => {
    const left = remaining(TARGETS, { kcal: 2600, proteinG: 200, fatG: 90, carbsG: 250 });
    expect(left.kcal).toBe(-300);
    expect(left.proteinG).toBe(-10);
  });

  it('never reports a negative gap to the fat floor', () => {
    const left = remaining(TARGETS, { kcal: 1000, proteinG: 50, fatG: 95, carbsG: 40 });
    expect(left.fatToFloorG).toBe(0);
  });

  it('reports progress as a percentage for the ring in the UI', () => {
    const left = remaining(TARGETS, { kcal: 1150, proteinG: 95, fatG: 35, carbsG: 100 });
    expect(left.kcalPct).toBe(50);
    expect(left.proteinPct).toBe(50);
  });

  it('caps nothing — 120% of protein reads as 120%', () => {
    const left = remaining(TARGETS, { kcal: 0, proteinG: 228, fatG: 0, carbsG: 0 });
    expect(left.proteinPct).toBe(120);
  });

  it('is not tripped up by a zero target', () => {
    const left = remaining({ kcal: 0, proteinG: 0, fatFloorG: 0 }, sumMacros([]));
    expect(left.kcalPct).toBe(0);
    expect(left.proteinPct).toBe(0);
  });
});

describe('scaleMacros', () => {
  it('halves a portion, which is the entire mom-food rule', () => {
    expect(scaleMacros({ kcal: 800, proteinG: 30, fatG: 32, carbsG: 90 }, 0.5)).toEqual({
      kcal: 400,
      proteinG: 15,
      fatG: 16,
      carbsG: 45,
    });
  });

  it('rounds to whole grams', () => {
    expect(scaleMacros({ kcal: 801, proteinG: 31, fatG: 0, carbsG: 0 }, 0.5)).toEqual({
      kcal: 401,
      proteinG: 16,
      fatG: 0,
      carbsG: 0,
    });
  });
});
