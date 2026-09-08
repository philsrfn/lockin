import { describe, expect, it } from 'vitest';
import { MAX_PORTION_G, describePortion, portionOf, suggestedGrams } from '../portions';

const perHundred = { kcal: 62, proteinG: 10, fatG: 0, carbsG: 4 };
const aPortion = { kcal: 310, proteinG: 50, fatG: 2, carbsG: 20 };

describe('a food that is already a portion', () => {
  it('logs exactly as it stands', () => {
    expect(portionOf(aPortion, { perGrams: null })).toEqual(aPortion);
  });

  it('ignores grams, because they describe nothing', () => {
    expect(portionOf(aPortion, { perGrams: null, grams: 250 })).toEqual(aPortion);
  });
});

describe('a food measured by weight', () => {
  it('scales to what was eaten', () => {
    // 500 g of skyr at 62 kcal and 10 g protein per 100 g.
    expect(portionOf(perHundred, { perGrams: 100, grams: 500 })).toEqual({
      kcal: 310,
      proteinG: 50,
      fatG: 0,
      carbsG: 20,
    });
  });

  it('scales down as readily as up', () => {
    expect(portionOf(perHundred, { perGrams: 100, grams: 30 })).toMatchObject({
      kcal: 19,
      proteinG: 3,
    });
  });

  it('keeps a missing macro missing rather than inventing a zero', () => {
    const partial = { kcal: 400, proteinG: 8, fatG: null, carbsG: null };

    expect(portionOf(partial, { perGrams: 100, grams: 50 })).toEqual({
      kcal: 200,
      proteinG: 4,
      fatG: null,
      carbsG: null,
    });
  });

  it('refuses when nobody said how much', () => {
    // This is the bug that was live: the app hid the grams field on a second
    // scan and logged 100 g of whatever it was, silently.
    expect(portionOf(perHundred, { perGrams: 100 })).toBeNull();
    expect(portionOf(perHundred, { perGrams: 100, grams: null })).toBeNull();
  });

  it('refuses a portion nobody could eat', () => {
    // A missing decimal point, or a mis-tap. Both are typos, not meals.
    expect(portionOf(perHundred, { perGrams: 100, grams: 0 })).toBeNull();
    expect(portionOf(perHundred, { perGrams: 100, grams: -50 })).toBeNull();
    expect(portionOf(perHundred, { perGrams: 100, grams: MAX_PORTION_G + 1 })).toBeNull();
    expect(portionOf(perHundred, { perGrams: 100, grams: Number.NaN })).toBeNull();
  });

  it('accepts the largest portion it will take', () => {
    expect(portionOf(perHundred, { perGrams: 100, grams: MAX_PORTION_G })).not.toBeNull();
  });
});

describe('what the log line says', () => {
  it('puts the weight in the description, so it can be checked later', () => {
    expect(describePortion('Skyr', { perGrams: 100, grams: 500 })).toBe('Skyr (500 g)');
  });

  it('leaves a portion food alone', () => {
    expect(describePortion('Protein shake', { perGrams: null })).toBe('Protein shake');
  });
});

describe('what to offer when asking how much', () => {
  it('offers last time, because somebody chose it', () => {
    expect(suggestedGrams(60, 100)).toBe(60);
  });

  it('falls back to the basis when there is no last time', () => {
    // 100 is not a good guess, it is just the number the label is printed
    // against. It is only ever the opening offer.
    expect(suggestedGrams(null, 100)).toBe(100);
  });

  it('has nothing to suggest for a portion food', () => {
    expect(suggestedGrams(60, null)).toBeNull();
  });
});
