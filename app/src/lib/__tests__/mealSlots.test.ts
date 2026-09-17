import { describe, expect, it } from 'vitest';
import { slotForHour } from '../mealSlots';

describe('slotForHour', () => {
  it('guesses the slot a day actually has at that hour', () => {
    expect(slotForHour(7)).toBe('breakfast');
    expect(slotForHour(13)).toBe('lunch');
    expect(slotForHour(19)).toBe('dinner');
  });

  it('calls the gaps between meals a snack', () => {
    expect(slotForHour(16)).toBe('snack');
    expect(slotForHour(23)).toBe('snack');
    expect(slotForHour(2)).toBe('snack');
  });

  it('puts each boundary on the side a person would', () => {
    expect(slotForHour(10)).toBe('breakfast');
    expect(slotForHour(11)).toBe('lunch');
    expect(slotForHour(15)).toBe('snack');
    expect(slotForHour(17)).toBe('dinner');
    expect(slotForHour(22)).toBe('snack');
  });
});
