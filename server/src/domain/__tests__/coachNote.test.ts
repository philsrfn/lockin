import { describe, expect, it } from 'vitest';
import { noteStillFits } from '../coachNote';

const inMuenster = { contextName: 'Münster', dayCodes: ['A', 'B', 'C'] };

describe('whether this morning\'s note still describes today', () => {
  it('keeps it when nothing moved', () => {
    expect(noteStillFits({ template: 'B', contextName: 'Münster' }, inMuenster)).toBe(true);
  });

  it('drops it when they have moved city', () => {
    // Different gym, different food rules — the note was written about neither.
    expect(noteStillFits({ template: 'B', contextName: 'Leipzig' }, inMuenster)).toBe(false);
  });

  it('drops it when the programme no longer has the day it named', () => {
    // The bug this exists for: the card said "Einheit B" while the plan under
    // it said Push, because switching programmes left the morning's note in
    // place naming a day that no longer existed.
    expect(
      noteStillFits(
        { template: 'B', contextName: 'Münster' },
        { contextName: 'Münster', dayCodes: ['PUSH', 'PULL', 'LEGS'] },
      ),
    ).toBe(false);
  });

  it('keeps a rest day through a programme change', () => {
    // A rest day is a rest day whichever programme it is a rest from, and
    // regenerating one costs a model call to be told the same thing.
    expect(
      noteStillFits(
        { template: null, contextName: 'Münster' },
        { contextName: 'Münster', dayCodes: ['PUSH', 'PULL'] },
      ),
    ).toBe(true);
  });

  it('drops a rest day when they have moved anyway', () => {
    expect(
      noteStillFits({ template: null, contextName: 'Münster' }, { contextName: 'Home', dayCodes: [] }),
    ).toBe(false);
  });

  it('treats having no place at all as a place, not as a wildcard', () => {
    // Both null is the same world; null against a name is not.
    expect(noteStillFits({ template: 'A', contextName: null }, { contextName: null, dayCodes: ['A'] })).toBe(true);
    expect(noteStillFits({ template: 'A', contextName: null }, inMuenster)).toBe(false);
  });
});
