import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/error';
import { messageFor } from '../apiError';
import { setPreferredLocale, t } from '../locale';

const german = () => setPreferredLocale('de-DE');
const english = () => setPreferredLocale('en-GB');

describe('what an athlete is told when a request fails', () => {
  it('answers a coded failure in their language', () => {
    // The one from the roadmap: scanning a tub the food database has never
    // heard of, on an otherwise German screen.
    german();
    const notThere = new ApiError(404, 'No product with that barcode', undefined, 'barcode_unknown');

    expect(messageFor(notThere, 'lookupFailed')).toBe(
      'Kein Produkt mit diesem Barcode. Trag es von Hand ein.',
    );
  });

  it('answers the same failure in English for an English athlete', () => {
    english();
    const notThere = new ApiError(404, 'No product with that barcode', undefined, 'barcode_unknown');

    expect(messageFor(notThere, 'lookupFailed')).toBe('No product with that barcode. Enter it by hand.');
  });

  it('falls back to the server for a code it has no words for', () => {
    // Deliberate: those are the ones only reachable when something is broken,
    // and an English sentence about a bug beats a vague one about nothing.
    german();
    const odd = new ApiError(400, 'setIndex starts at 1', undefined, 'not_a_code_we_know');

    expect(messageFor(odd, 'couldNotSave')).toBe('setIndex starts at 1');
  });

  it('falls back to the server when there is no code at all', () => {
    german();

    expect(messageFor(new ApiError(400, 'kcal must be a number'), 'couldNotSave')).toBe(
      'kcal must be a number',
    );
  });

  it('says the connection is gone rather than repeating what fetch threw', () => {
    // status 0 is the client's own timeout or a dropped socket. Its message is
    // "Network request failed", which is true and useless.
    german();

    expect(messageFor(new ApiError(0, 'Network request failed'), 'couldNotSave')).toBe(
      'Keine Verbindung zum Server. Was du einträgst, wird nachgereicht.',
    );
  });

  it('uses the screen\'s own words for something that is not an ApiError at all', () => {
    german();

    // Against the phrase rather than the wording: what is being tested is
    // that it falls back, not how that sentence happens to read today.
    expect(messageFor(new TypeError('undefined is not an object'), 'couldNotLoadRules')).toBe(
      t('couldNotLoadRules'),
    );
  });

  it('uses the screen\'s own words when the server sent an empty message', () => {
    german();

    expect(messageFor(new ApiError(500, ''), 'couldNotSave')).toBe(t('couldNotSave'));
  });
});
