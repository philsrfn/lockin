import { describe, expect, it } from 'vitest';
import { buildTrainingGrid, trainedDaysFrom } from '../trainingGrid';

/** 2026-09-15 is a Tuesday, which is the point of every case below. */
const TUESDAY = '2026-09-15';

const flat = (grid: ReturnType<typeof buildTrainingGrid>) =>
  grid.weeks.flat().filter((cell): cell is NonNullable<typeof cell> => cell !== null);

describe('buildTrainingGrid', () => {
  it('covers exactly the range asked for, today included', () => {
    const grid = buildTrainingGrid([], TUESDAY, 30);
    const days = flat(grid);

    expect(days).toHaveLength(30);
    expect(days[0]?.day).toBe('2026-08-17');
    expect(days.at(-1)?.day).toBe(TUESDAY);
    expect(grid.totalDays).toBe(30);
  });

  it('starts every column on a Monday', () => {
    const grid = buildTrainingGrid([], TUESDAY, 30);

    for (const week of grid.weeks) {
      const first = week.find((cell) => cell !== null);
      expect(first).toBeDefined();
      // Only the first and last columns may be padded; everywhere else the
      // Monday slot is a real day.
      if (week[0] !== null) {
        expect(new Date(`${week[0].day}T00:00:00Z`).getUTCDay()).toBe(1);
      }
    }
  });

  it('pads the days before the range rather than calling them rest days', () => {
    // 2026-08-17 is itself a Monday, so a 30-day range needs no leading pad;
    // a 29-day one starts on the Tuesday and must.
    const grid = buildTrainingGrid([], TUESDAY, 29);

    expect(grid.weeks[0]?.[0]).toBeNull();
    expect(grid.weeks[0]?.[1]?.day).toBe('2026-08-18');
    expect(grid.totalDays).toBe(29);
  });

  it('pads the rest of the week after today', () => {
    const grid = buildTrainingGrid([], TUESDAY, 30);
    const last = grid.weeks.at(-1);

    expect(last?.[1]?.day).toBe(TUESDAY);
    // Wednesday to Sunday have not happened yet.
    expect(last?.slice(2)).toEqual([null, null, null, null, null]);
  });

  it('marks only the days that were trained', () => {
    const grid = buildTrainingGrid(['2026-09-14', '2026-09-10'], TUESDAY, 30);
    const days = flat(grid);

    expect(days.filter((day) => day.trained).map((day) => day.day)).toEqual([
      '2026-09-10',
      '2026-09-14',
    ]);
    expect(grid.trainedDays).toBe(2);
  });

  it('ignores trained days that fall outside the range', () => {
    const grid = buildTrainingGrid(['2025-01-01', '2026-09-16'], TUESDAY, 30);

    expect(grid.trainedDays).toBe(0);
  });

  it('labels each month over the column it starts in', () => {
    const grid = buildTrainingGrid([], TUESDAY, 365);
    const labelled = grid.months.map((month) => month.day.slice(0, 7));

    // A year back from September 2026 is September 2025, and no month may
    // appear twice — a duplicate would mean a label per column.
    expect(labelled[0]).toBe('2025-09');
    expect(labelled.at(-1)).toBe('2026-09');
    expect(new Set(labelled).size).toBe(labelled.length);
  });

  it('crosses a leap day without losing one', () => {
    const grid = buildTrainingGrid([], '2028-03-01', 3);
    expect(flat(grid).map((cell) => cell.day)).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });
});

describe('trainedDaysFrom', () => {
  it('counts a day with only cardio', () => {
    const trained = trainedDaysFrom([{ day: '2026-09-14', sessions: [], cardio: [{}] }]);
    expect(trained.has('2026-09-14')).toBe(true);
  });

  it('counts a day with only lifting', () => {
    const trained = trainedDaysFrom([{ day: '2026-09-14', sessions: [{}], cardio: [] }]);
    expect(trained.has('2026-09-14')).toBe(true);
  });

  it('does not count a day the server sent with nothing in it', () => {
    const trained = trainedDaysFrom([{ day: '2026-09-14', sessions: [], cardio: [] }]);
    expect(trained.size).toBe(0);
  });
});
