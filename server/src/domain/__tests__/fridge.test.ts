import { describe, expect, it } from 'vitest';
import { MAX_INVENTORY_AGE_HOURS, inventoryAge } from '../fridge';

const at = (iso: string) => new Date(iso);
const hoursAfter = (iso: string, hours: number) =>
  new Date(at(iso).getTime() + hours * 3_600_000);

describe('how old a fridge list is', () => {
  const captured = '2026-09-04T09:00:00Z';

  it('is fresh, and not worth mentioning, minutes after the photo', () => {
    const age = inventoryAge(at(captured), hoursAfter(captured, 0.5));

    expect(age).toEqual({ hours: 1, stale: false, worthMentioning: false });
  });

  it('becomes worth mentioning once it is yesterday', () => {
    const age = inventoryAge(at(captured), hoursAfter(captured, 20));

    expect(age.worthMentioning).toBe(true);
    expect(age.stale).toBe(false);
  });

  it('still plans from a weekly shop three days later', () => {
    expect(inventoryAge(at(captured), hoursAfter(captured, 72)).stale).toBe(false);
  });

  it('goes stale past four days, because the food has been eaten by then', () => {
    expect(inventoryAge(at(captured), hoursAfter(captured, MAX_INVENTORY_AGE_HOURS)).stale).toBe(
      false,
    );
    expect(
      inventoryAge(at(captured), hoursAfter(captured, MAX_INVENTORY_AGE_HOURS + 1)).stale,
    ).toBe(true);
  });

  it('reads a list from the future as brand new rather than as impossibly fresh', () => {
    // A phone with a wrong clock, or a row written across a DST shift. A
    // negative age would pass every check by being smaller than all of them.
    const age = inventoryAge(hoursAfter(captured, 5), at(captured));

    expect(age).toEqual({ hours: 0, stale: false, worthMentioning: false });
  });
});
