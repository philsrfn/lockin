import { describe, expect, it } from 'vitest';
import {
  MAX_INCREMENT_KG,
  MAX_REST_SECONDS,
  MAX_SLOTS_PER_DAY,
  assignCodes,
  dayCodeFrom,
  validateDraft,
} from '../programDraft';

const slot = (exerciseId: number) => ({ exerciseId, sets: 3, repMin: 6, repMax: 10 });
const day = (name: string, ids = [1, 2]) => ({ name, slots: ids.map(slot) });

describe('turning a day name into a code', () => {
  it('takes the letters and shouts them', () => {
    expect(dayCodeFrom('Pull', [])).toBe('PULL');
  });

  it('drops spaces and punctuation', () => {
    expect(dayCodeFrom('Upper A', [])).toBe('UPPERA');
  });

  it('strips accents rather than dropping the letters', () => {
    // "Oberkörper" must not become OBERKRPER.
    expect(dayCodeFrom('Oberkörper', [])).toBe('OBERKORPER');
  });

  it('falls back rather than producing nothing', () => {
    expect(dayCodeFrom('💪', [])).toBe('DAY');
    expect(dayCodeFrom('   ', [])).toBe('DAY');
  });

  it('never collides, because two days with one code share a history', () => {
    expect(dayCodeFrom('Pull', ['PULL'])).toBe('PULL2');
    expect(dayCodeFrom('Pull', ['PULL', 'PULL2'])).toBe('PULL3');
  });

  it('keeps codes short enough to sit in the logger header', () => {
    expect(dayCodeFrom('Ganzkörpertraining schwer', []).length).toBeLessThanOrEqual(12);
  });
});

describe('keeping codes once they exist', () => {
  it('leaves an existing code alone when the name changes', () => {
    // Renaming a day is a label change. Rewriting its code would orphan every
    // session already logged against it.
    const [renamed] = assignCodes([{ code: 'PULL', name: 'Zug', slots: [slot(1)] }]);

    expect(renamed).toMatchObject({ code: 'PULL', name: 'Zug' });
  });

  it('derives one for a day that has never been saved', () => {
    const [fresh] = assignCodes([{ name: 'Legs', slots: [slot(1)] }]);

    expect(fresh?.code).toBe('LEGS');
  });

  it('does not hand a new day a code an old one already holds', () => {
    const days = assignCodes([
      { code: 'PUSH', name: 'Push', slots: [slot(1)] },
      { name: 'Push', slots: [slot(2)] },
    ]);

    expect(days.map((d) => d.code)).toEqual(['PUSH', 'PUSH2']);
  });
});

describe('what a programme has to be', () => {
  const ok = { name: 'Mein Plan', days: [day('Push'), day('Pull', [3, 4])] };

  it('accepts a sound one', () => {
    expect(validateDraft(ok)).toEqual([]);
  });

  it('needs a name and at least one day', () => {
    expect(validateDraft({ name: '  ', days: [] })).toEqual(
      expect.arrayContaining(['name_missing', 'no_days']),
    );
  });

  it('refuses a day with nothing in it', () => {
    expect(validateDraft({ ...ok, days: [{ name: 'Push', slots: [] }] })).toContain('day_empty');
  });

  it('refuses the same movement twice in one day', () => {
    // Two slots on one exercise read as one history to the progression, so
    // the second would silently do nothing.
    expect(validateDraft({ ...ok, days: [day('Push', [1, 1])] })).toContain('duplicate_exercise');
  });

  it('refuses set counts and rep ranges nobody trains', () => {
    const bad = {
      name: 'x',
      days: [{ name: 'd', slots: [{ exerciseId: 1, sets: 0, repMin: 12, repMax: 3 }] }],
    };

    expect(validateDraft(bad)).toEqual(expect.arrayContaining(['bad_sets', 'bad_reps']));
  });

  it('caps the size of a day', () => {
    const many = Array.from({ length: MAX_SLOTS_PER_DAY + 1 }, (_, i) => slot(i + 1));

    expect(validateDraft({ ...ok, days: [{ name: 'd', slots: many }] })).toContain(
      'too_many_slots',
    );
  });

  it('reports everything wrong at once, not the first thing', () => {
    const bad = { name: '', days: [{ name: '', slots: [] }] };

    expect(validateDraft(bad).length).toBeGreaterThan(2);
  });
});

describe('rest and increment, when the athlete sets them', () => {
  const withSlot = (extra: Record<string, number>) => ({
    name: 'Mein Plan',
    days: [{ name: 'Push', slots: [{ exerciseId: 1, sets: 3, repMin: 6, repMax: 10, ...extra }] }],
  });

  it('leaves them alone when they are absent', () => {
    // Absent is the ordinary case and means the movement decides. It is also
    // the only case the trainer's edit_program produces, so a validator that
    // demanded them would break every tool call.
    expect(validateDraft(withSlot({}))).toEqual([]);
  });

  it('accepts a rest somebody would actually take', () => {
    expect(validateDraft(withSlot({ restSeconds: 90 }))).toEqual([]);
    // Zero is a superset, not a mistake.
    expect(validateDraft(withSlot({ restSeconds: 0 }))).toEqual([]);
  });

  it('refuses a rest that is negative or longer than a training session', () => {
    expect(validateDraft(withSlot({ restSeconds: -1 }))).toContain('bad_rest');
    expect(validateDraft(withSlot({ restSeconds: MAX_REST_SECONDS + 1 }))).toContain('bad_rest');
    expect(validateDraft(withSlot({ restSeconds: 90.5 }))).toContain('bad_rest');
  });

  it('accepts the jumps that exist on a rack', () => {
    for (const increment of [0.5, 1, 1.25, 2.5, 5]) {
      expect(validateDraft(withSlot({ incrementKg: increment }))).toEqual([]);
    }
  });

  it('refuses an increment no plate can make', () => {
    // 0.1 kg is not a plate. An increment that does not exist in the room
    // produces prescriptions that cannot be loaded onto the bar.
    expect(validateDraft(withSlot({ incrementKg: 0.1 }))).toContain('bad_increment');
    expect(validateDraft(withSlot({ incrementKg: 0 }))).toContain('bad_increment');
    expect(validateDraft(withSlot({ incrementKg: -2.5 }))).toContain('bad_increment');
    expect(validateDraft(withSlot({ incrementKg: MAX_INCREMENT_KG + 0.25 }))).toContain(
      'bad_increment',
    );
  });

  it('does not trip over the way binary stores a quarter', () => {
    // (0.1 + 0.2) * 5 is 1.5000000000000002, which is 1.5 to everybody except
    // a modulo. The tolerance exists so that a value is judged on what it
    // means rather than on how it was stored.
    expect((0.1 + 0.2) * 5).not.toBe(1.5);
    expect(validateDraft(withSlot({ incrementKg: (0.1 + 0.2) * 5 }))).toEqual([]);
  });
});
