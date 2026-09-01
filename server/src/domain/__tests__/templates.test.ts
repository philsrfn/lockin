import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_ROTATION, isTemplateId, nextTemplate, templateExerciseNames } from '../templates';

describe('TEMPLATES', () => {
  it('has three full-body days of six movements each', () => {
    expect(Object.keys(TEMPLATES)).toEqual(['A', 'B', 'C']);
    for (const id of TEMPLATE_ROTATION) {
      expect(TEMPLATES[id]).toHaveLength(6);
    }
  });

  it('never repeats an exercise within a day', () => {
    for (const id of TEMPLATE_ROTATION) {
      const names = TEMPLATES[id].map((slot) => slot.exerciseName);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('prescribes a real plate jump and a rest duration for every slot', () => {
    for (const id of TEMPLATE_ROTATION) {
      for (const slot of TEMPLATES[id]) {
        expect(slot.incrementKg).toBeGreaterThan(0);
        expect(slot.restSeconds).toBeGreaterThan(0);
        expect(slot.range.min).toBeLessThan(slot.range.max);
      }
    }
  });
});

describe('nextTemplate', () => {
  it('starts at A', () => {
    expect(nextTemplate(null)).toBe('A');
  });

  it('rotates A to B to C and back to A', () => {
    expect(nextTemplate('A')).toBe('B');
    expect(nextTemplate('B')).toBe('C');
    expect(nextTemplate('C')).toBe('A');
  });
});

describe('templateExerciseNames', () => {
  it('lists every referenced exercise once', () => {
    const names = templateExerciseNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Back Squat');
    expect(names).toHaveLength(18);
  });
});

describe('isTemplateId', () => {
  it('accepts only A, B and C', () => {
    expect(isTemplateId('A')).toBe(true);
    expect(isTemplateId('D')).toBe(false);
    expect(isTemplateId(null)).toBe(false);
  });
});
