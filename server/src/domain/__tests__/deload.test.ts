import { describe, expect, it } from 'vitest';
import { DELOAD_LOAD_FACTOR, deloadSets, deloadStatus } from '../deload';

describe('deloadSets', () => {
  it('takes one working set off', () => {
    expect(deloadSets(3)).toBe(2);
  });

  it('never takes the last one', () => {
    expect(deloadSets(1)).toBe(1);
  });
});

describe('deloadStatus', () => {
  it('is not due part-way through a block', () => {
    const status = deloadStatus({ trainingWeeks: 4, everyWeeks: 8, activeThisWeek: false });

    expect(status.due).toBe(false);
    expect(status.active).toBe(false);
    expect(status.reason).toBeNull();
  });

  it('comes due on schedule', () => {
    expect(deloadStatus({ trainingWeeks: 8, everyWeeks: 8, activeThisWeek: false }).due).toBe(true);
  });

  it('is not due again while one is running', () => {
    const status = deloadStatus({ trainingWeeks: 8, everyWeeks: 8, activeThisWeek: true });

    expect(status.due).toBe(false);
    expect(status.active).toBe(true);
  });

  it('says why, once, in a voice a person would use', () => {
    const status = deloadStatus({
      trainingWeeks: 0,
      everyWeeks: 8,
      activeThisWeek: true,
      earnedAfterWeeks: 9,
    });

    expect(status.reason).toContain('Light week');
    expect(status.reason).toContain('10%');
    // The counter resets the moment the deload is recorded, so the message
    // must quote the block that earned it. Reading the live counter produced
    // "you have trained 0 weeks straight".
    expect(status.reason).toContain('9 weeks');
  });

  it('falls back to the schedule when the block was never recorded', () => {
    const status = deloadStatus({ trainingWeeks: 0, everyWeeks: 8, activeThisWeek: true });

    expect(status.reason).toContain('8 weeks');
    expect(status.reason).not.toContain('0 weeks');
  });

  it('can be turned off', () => {
    const status = deloadStatus({ trainingWeeks: 40, everyWeeks: 0, activeThisWeek: false });

    expect(status.due).toBe(false);
    expect(status.everyWeeks).toBe(0);
  });

  it('takes a tenth off the bar', () => {
    expect(DELOAD_LOAD_FACTOR).toBe(0.9);
  });
});
