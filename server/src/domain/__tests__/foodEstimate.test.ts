import { describe, expect, it } from 'vitest';
import { clampEstimate } from '../foodEstimate';

const sane = {
  name: 'Hähnchenbrust mit Reis',
  kcal: 710,
  proteinG: 69,
  fatG: 11,
  carbsG: 75,
  confidence: 'high',
  assumptions: '',
};

describe('what the model said, made safe to show', () => {
  it('passes a sane answer through unchanged', () => {
    expect(clampEstimate(sane, 'Foto')).toEqual(sane);
  });

  it('will not put a whole day on one plate', () => {
    // A model that lost its footing should produce a number somebody notices,
    // not one that quietly ruins a week of totals.
    const wild = clampEstimate({ ...sane, kcal: 40_000, proteinG: 9000 }, 'Foto');

    expect(wild.kcal).toBe(5000);
    expect(wild.proteinG).toBe(500);
  });

  it('refuses negative food', () => {
    expect(clampEstimate({ ...sane, kcal: -200, fatG: -1 }, 'Foto')).toMatchObject({
      kcal: 0,
      fatG: 0,
    });
  });

  it('turns a missing number into zero rather than NaN', () => {
    // NaN in a macro is NaN in the day's total, and then in the week's.
    const empty = clampEstimate({}, 'Foto');

    expect(empty.kcal).toBe(0);
    expect(Number.isFinite(empty.proteinG)).toBe(true);
  });

  it('turns a number that arrived as text into a number', () => {
    expect(clampEstimate({ ...sane, kcal: '710' }, 'Foto').kcal).toBe(710);
  });

  it('rounds, because half a calorie is not a thing anybody logs', () => {
    expect(clampEstimate({ ...sane, proteinG: 68.6 }, 'Foto').proteinG).toBe(69);
  });

  it('reads an unknown confidence as low, which asks somebody to look', () => {
    // Defaulting the other way would hide exactly the estimates worth checking.
    expect(clampEstimate({ ...sane, confidence: 'fairly sure' }, 'Foto').confidence).toBe('low');
    expect(clampEstimate({ ...sane, confidence: undefined }, 'Foto').confidence).toBe('low');
  });

  it('falls back to the name it was given when the model gives none', () => {
    expect(clampEstimate({ ...sane, name: '' }, 'Foto').name).toBe('Foto');
    expect(clampEstimate({ ...sane, name: '   ' }, 'Foto').name).toBe('Foto');
  });

  it('does not let a model write an essay into a meal name', () => {
    const long = clampEstimate({ ...sane, name: 'x'.repeat(500) }, 'Foto');

    expect(long.name).toHaveLength(120);
  });

  it('bounds the assumption too', () => {
    expect(clampEstimate({ ...sane, assumptions: 'y'.repeat(900) }, 'Foto').assumptions)
      .toHaveLength(300);
  });
});
