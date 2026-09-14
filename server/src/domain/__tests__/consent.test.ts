import { describe, expect, it } from 'vitest';
import { CURRENT_VERSIONS, hasAgreedToEverything, missingConsents } from '../consent';

const current = (document: 'privacy' | 'terms') => ({
  document,
  version: CURRENT_VERSIONS[document],
  withdrawnAt: null,
});

describe('what somebody still owes agreement to', () => {
  it('is everything, before they have agreed to anything', () => {
    expect(missingConsents([])).toEqual(['privacy', 'terms']);
  });

  it('is nothing, once both are agreed', () => {
    expect(hasAgreedToEverything([current('privacy'), current('terms')])).toBe(true);
  });

  it('still counts one that is missing when the other is given', () => {
    expect(missingConsents([current('privacy')])).toEqual(['terms']);
  });

  it('does not count a consent to an older version', () => {
    // The reason the version is stored at all: a notice that changed is a
    // different thing to have agreed to.
    const stale = { document: 'privacy', version: '2020-01-01', withdrawnAt: null };

    expect(missingConsents([stale, current('terms')])).toEqual(['privacy']);
  });

  it('does not count one that was withdrawn', () => {
    const withdrawn = { ...current('privacy'), withdrawnAt: new Date() };

    expect(missingConsents([withdrawn, current('terms')])).toEqual(['privacy']);
  });

  it('ignores a document it does not know about', () => {
    const unknown = { document: 'cookies', version: '2026-01-01', withdrawnAt: null };

    expect(missingConsents([unknown])).toEqual(['privacy', 'terms']);
  });
});
