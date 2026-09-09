import { describe, expect, it } from 'vitest';
import { earnsItsPlace, libraryKey, libraryKeyFor } from '../foodLibrary';

describe('recognising the same food twice', () => {
  it('ignores case and spacing', () => {
    expect(libraryKey('  Skyr  mit   Beeren ')).toBe(libraryKey('skyr mit beeren'));
  });

  it('keeps genuinely different descriptions apart', () => {
    // They have different macros. Guessing they are one thing would put a
    // number in the library that nobody ate.
    expect(libraryKey('Skyr mit Beeren')).not.toBe(libraryKey('Skyr, 500g, mit Beeren'));
  });
});

describe('which meals are worth keeping', () => {
  const meal = { description: 'Skyr mit Beeren', kcal: 320, proteinG: 30 };

  it('keeps one that was described in words and has macros', () => {
    expect(libraryKeyFor(meal)).toBe('skyr mit beeren');
  });

  it('skips one that already came from the library', () => {
    expect(libraryKeyFor({ ...meal, foodId: 7 })).toBeNull();
  });

  it('skips one with no macros, which could not be tapped to log anything', () => {
    expect(libraryKeyFor({ ...meal, kcal: null })).toBeNull();
    expect(libraryKeyFor({ ...meal, proteinG: null })).toBeNull();
  });

  it('skips a description that is only whitespace', () => {
    expect(libraryKeyFor({ ...meal, description: '   ' })).toBeNull();
  });
});

describe('when a food earns a place in the library', () => {
  it('not the first time it is eaten', () => {
    // A restaurant meal nobody repeats is a meal, not a staple, and the
    // library is a list of things to tap rather than a diary.
    expect(earnsItsPlace(0)).toBe(false);
  });

  it('on the second', () => {
    expect(earnsItsPlace(1)).toBe(true);
    expect(earnsItsPlace(9)).toBe(true);
  });
});
