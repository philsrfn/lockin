import { describe, expect, it } from 'vitest';
import { QUIET_AFTER_DAYS, SILENT_AFTER_DAYS, engagement } from '../engagement';

const now = new Date('2026-09-03T08:00:00Z');
const daysBefore = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('engagement', () => {
  it('coaches somebody who was here this morning', () => {
    expect(engagement(daysBefore(0), now)).toEqual({
      daysAway: 0,
      writeCoachNote: true,
      push: true,
    });
  });

  it('keeps coaching through a couple of quiet days', () => {
    // A weekend away is not somebody leaving.
    expect(engagement(daysBefore(3), now).writeCoachNote).toBe(true);
  });

  it('stops paying for a note once nobody is reading it', () => {
    const away = engagement(daysBefore(QUIET_AFTER_DAYS), now);

    expect(away.writeCoachNote).toBe(false);
    // Still nudged, because a notification is free and might bring them back.
    expect(away.push).toBe(true);
  });

  it('stops tapping the shoulder after a fortnight', () => {
    const gone = engagement(daysBefore(SILENT_AFTER_DAYS), now);

    expect(gone.push).toBe(false);
    expect(gone.writeCoachNote).toBe(false);
  });

  it('coaches somebody it has never measured', () => {
    // A brand-new athlete, or one from before this was recorded. Being wrong
    // towards "still here" costs one model call; being wrong the other way
    // silently abandons them.
    expect(engagement(null, now)).toEqual({
      daysAway: null,
      writeCoachNote: true,
      push: true,
    });
  });

  it('comes straight back when they do', () => {
    expect(engagement(daysBefore(30), now).push).toBe(false);
    expect(engagement(daysBefore(0), now).push).toBe(true);
  });

  it('does not go negative on a clock that disagrees', () => {
    expect(engagement(new Date(now.getTime() + 60_000), now).daysAway).toBe(0);
  });
});
