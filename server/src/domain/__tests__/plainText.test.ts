import { describe, expect, it } from 'vitest';
import { plainText } from '../plainText';

describe('markdown in a reply that is printed as plain text', () => {
  it('unwraps bold, which is what the model actually reaches for', () => {
    expect(plainText('Du hast noch **190 g Protein** offen.')).toBe(
      'Du hast noch 190 g Protein offen.',
    );
  });

  it('unwraps italics and underscores', () => {
    expect(plainText('Das ist *wichtig* und __sehr__ wichtig.')).toBe(
      'Das ist wichtig und sehr wichtig.',
    );
  });

  it('unwraps code ticks', () => {
    expect(plainText('Ruf `get_today` auf.')).toBe('Ruf get_today auf.');
  });

  it('drops heading hashes and keeps the words', () => {
    expect(plainText('## Heute\nPush.')).toBe('Heute\nPush.');
  });

  it('turns a list marker into something that is not an unclosed emphasis', () => {
    expect(plainText('- Kniebeugen\n* Bankdrücken')).toBe('• Kniebeugen\n• Bankdrücken');
  });

  it('leaves arithmetic alone', () => {
    // The reason this is conservative: a trainer's reply is full of things
    // that look like markup and are not.
    expect(plainText('3*8 Wiederholungen')).toBe('3*8 Wiederholungen');
    expect(plainText('2 * 3 Sätze')).toBe('2 * 3 Sätze');
  });

  it('leaves a lone marker alone', () => {
    expect(plainText('Gewicht * 2')).toBe('Gewicht * 2');
    expect(plainText('snake_case_name')).toBe('snake_case_name');
  });

  it('does not reach across a line break', () => {
    expect(plainText('erste *zeile\nzweite* zeile')).toBe('erste *zeile\nzweite* zeile');
  });

  it('leaves a plain reply exactly as it was', () => {
    const reply = 'Noch 40 g Protein. Ein Skyr reicht.';

    expect(plainText(reply)).toBe(reply);
  });

  it('handles bold inside a sentence with other punctuation', () => {
    expect(plainText('Ziel: **2.300 kcal** — bleibt.')).toBe('Ziel: 2.300 kcal — bleibt.');
  });
});
