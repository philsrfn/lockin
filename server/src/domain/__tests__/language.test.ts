import { describe, expect, it } from 'vitest';
import { languageInstruction, languageName } from '../language';

describe('languageName', () => {
  it('names the language of a locale tag', () => {
    expect(languageName('de')).toBe('German');
    expect(languageName('de-DE')).toBe('German');
    expect(languageName('en-GB')).toBe('English');
    expect(languageName('fr-CA')).toBe('French');
  });

  it('falls back to English when nobody has said', () => {
    expect(languageName(null)).toBe('English');
    expect(languageName(undefined)).toBe('English');
    expect(languageName('')).toBe('English');
  });

  it('falls back rather than passing nonsense to the model', () => {
    expect(languageName('zz')).toBe('English');
  });
});

describe('languageInstruction', () => {
  it('is one short line, because it rides along on every request', () => {
    expect(languageInstruction('de')).toBe('Write to him in German.');
    expect(languageInstruction(null)).toBe('Write to him in English.');
  });
});
