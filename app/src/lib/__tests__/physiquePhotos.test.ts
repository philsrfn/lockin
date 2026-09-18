import { describe, expect, it } from 'vitest';
import { deviceDay } from '../format';

/**
 * The date a progress photograph is filed under. It lives in `format.ts`
 * rather than beside the code that uses it because `physiquePhotos.ts`
 * imports the native filesystem, and a test that loads that loads a native
 * module that is not there.
 */
describe('deviceDay', () => {
  it('uses local time, not UTC', () => {
    // The photograph that made this necessary: taken late on a Sunday night
    // in Berlin, which is already Monday in UTC. Filed under Monday it would
    // read as this week's when it is last week's, and the whole feature is
    // about which week a picture belongs to.
    const lateSunday = new Date(2026, 8, 13, 23, 30);
    expect(deviceDay(lateSunday)).toBe('2026-09-13');
  });

  it('pads a single-digit month and day', () => {
    expect(deviceDay(new Date(2026, 0, 5, 9, 0))).toBe('2026-01-05');
  });
});
