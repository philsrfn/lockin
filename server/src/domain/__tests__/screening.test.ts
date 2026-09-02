import { describe, expect, it } from 'vitest';
import { SUPPORT_NOTE, bmi, goalWeightConcern, screen } from '../screening';

const ADULT = { sex: 'female', heightCm: 165, weightKg: 62, ageYears: 30 } as const;
const UNDERWEIGHT = { sex: 'female', heightCm: 165, weightKg: 47, ageYears: 30 } as const;
const TEENAGER = { sex: 'male', heightCm: 172, weightKg: 75, ageYears: 16 } as const;

describe('bmi', () => {
  it('is weight over height squared', () => {
    expect(bmi(191, 91.2)).toBeCloseTo(25, 1);
    expect(bmi(165, 47)).toBeCloseTo(17.3, 1);
  });
});

describe('screen', () => {
  it('leaves an ordinary cut alone', () => {
    const result = screen({ ...ADULT, goal: 'lose' });

    expect(result.goal).toBe('lose');
    expect(result.concerns).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.signpost).toBe(false);
  });

  it('will not set a deficit for somebody already underweight', () => {
    const result = screen({ ...UNDERWEIGHT, goal: 'lose' });

    expect(result.goal).toBe('maintain');
    expect(result.concerns).toContain('underweight');
  });

  it('leaves an underweight athlete something they can still do', () => {
    // A refusal that ends the conversation is a refusal people work around.
    const result = screen({ ...UNDERWEIGHT, goal: 'lose' });

    expect(result.notes.join(' ')).toContain('Training and protein still do their job');
  });

  it('points at somebody qualified rather than diagnosing', () => {
    const result = screen({ ...UNDERWEIGHT, goal: 'lose' });

    expect(result.signpost).toBe(true);
    expect(result.notes).toContain(SUPPORT_NOTE);
    // No diagnosis, no scare words.
    expect(result.notes.join(' ')).not.toMatch(/disorder|anorexi|suffer/i);
  });

  it('does not stand in the way of an underweight athlete gaining', () => {
    const result = screen({ ...UNDERWEIGHT, goal: 'gain' });

    expect(result.goal).toBe('gain');
  });

  it('still signposts when they are underweight and holding', () => {
    const result = screen({ ...UNDERWEIGHT, goal: 'maintain' });

    expect(result.goal).toBe('maintain');
    expect(result.signpost).toBe(true);
  });

  it('will not set a deficit for somebody still growing', () => {
    const result = screen({ ...TEENAGER, goal: 'lose' });

    expect(result.goal).toBe('maintain');
    expect(result.concerns).toContain('minor');
    expect(result.notes.join(' ')).toContain('doctor');
  });

  it('lets a teenager train and eat to maintain', () => {
    const result = screen({ ...TEENAGER, goal: 'maintain' });

    expect(result.goal).toBe('maintain');
    expect(result.notes).toEqual([]);
  });

  it('says both things when both apply', () => {
    const result = screen({ sex: 'female', heightCm: 165, weightKg: 45, ageYears: 16, goal: 'lose' });

    expect(result.concerns).toEqual(['underweight', 'minor']);
    expect(result.goal).toBe('maintain');
  });
});

describe('goalWeightConcern', () => {
  it('flags a goal that would take somebody under a healthy weight', () => {
    expect(goalWeightConcern(165, 48)).toBe('goal_below_healthy');
  });

  it('says nothing about a sensible goal', () => {
    expect(goalWeightConcern(165, 58)).toBeNull();
    expect(goalWeightConcern(191, 80)).toBeNull();
  });
});
