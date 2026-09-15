/**
 * Programmes an athlete builds themselves.
 *
 * The rules that matter here are not about shapes — those are covered without
 * a database in `domain/__tests__/programDraft.test.ts`. They are about what
 * a programme means over time: a day code is written into every session
 * logged against it, so it must survive a rename, and one athlete must never
 * be able to edit another's plan or a built-in one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import {
  createProgram,
  currentProgram,
  deleteProgram,
  listPrograms,
  programBySlug,
  saveProgram,
  setProgram,
  slotsFor,
} from '../programs';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

const draft = async (dayName = 'Zug') => ({
  name: 'Mein Plan',
  days: [
    {
      name: dayName,
      slots: [
        { exerciseId: await exerciseIdByName('Lat Pulldown'), sets: 3, repMin: 6, repMax: 10 },
        { exerciseId: await exerciseIdByName('Barbell Row'), sets: 3, repMin: 6, repMax: 10 },
      ],
    },
  ],
});

describe('building one from nothing', () => {
  it('creates it empty and lists it beside the catalogue', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });

    expect(created.name).toBe('Mein Plan');
    expect((await listPrograms(phil)).map((p) => p.name)).toContain('Mein Plan');
  });

  it('marks which of the listed programmes are the athlete\'s own', async () => {
    // The account screen offers "edit" on one and "use as a template" on the
    // other, so it has to be able to tell them apart without guessing from
    // the slug.
    await createProgram(phil, { name: 'Mein Plan' });
    const listed = await listPrograms(phil);

    expect(listed.find((p) => p.name === 'Mein Plan')?.mine).toBe(true);
    expect(listed.filter((p) => !p.mine).length).toBeGreaterThan(0);
    expect(listed.filter((p) => p.mine)).toHaveLength(1);
  });

  it('does not mark another athlete\'s programme as anybody else\'s', async () => {
    await createProgram(sam, { name: 'Sams Plan' });

    expect((await listPrograms(phil)).map((p) => p.name)).not.toContain('Sams Plan');
    expect((await listPrograms(sam)).find((p) => p.name === 'Sams Plan')?.mine).toBe(true);
  });

  it('fills in days and exercises on save', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });

    const saved = await saveProgram(phil, created.id, await draft());

    expect(saved.days.map((day) => day.name)).toEqual(['Zug']);
    const slots = await slotsFor(phil, saved.id, saved.days[0]!.code);
    expect(slots.map((slot) => slot.exerciseName)).toEqual(['Lat Pulldown', 'Barbell Row']);
  });

  it('falls back to the movement when the athlete says nothing', async () => {
    // Absent is the ordinary case, and it is the only case the trainer's
    // edit_program can produce — §6 promises the model it does not set these.
    const created = await createProgram(phil, { name: 'Mein Plan' });
    const saved = await saveProgram(phil, created.id, await draft());

    const [pulldown] = await slotsFor(phil, saved.id, saved.days[0]!.code);
    // Lat Pulldown is v_pull: 2.5 kg and 150 s from defaultsForPattern.
    expect(pulldown?.incrementKg).toBe(2.5);
    expect(pulldown?.restSeconds).toBe(150);
  });

  it('keeps a rest and an increment the athlete did set', async () => {
    // The pattern knows what a pulldown usually rests. It does not know that
    // this gym's stack moves in fives, and it used to overwrite the answer.
    const created = await createProgram(phil, { name: 'Mein Plan' });
    const base = await draft();
    const saved = await saveProgram(phil, created.id, {
      ...base,
      days: [
        {
          ...base.days[0]!,
          slots: [
            { ...base.days[0]!.slots[0]!, restSeconds: 45, incrementKg: 5 },
            base.days[0]!.slots[1]!,
          ],
        },
      ],
    });

    const [pulldown, row] = await slotsFor(phil, saved.id, saved.days[0]!.code);
    expect(pulldown?.restSeconds).toBe(45);
    expect(pulldown?.incrementKg).toBe(5);
    // The movement next to it is untouched, so an override is a slot's own.
    expect(row?.incrementKg).toBe(2.5);
  });

  it('refuses an increment that is not on any plate', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });
    const base = await draft();

    await expect(
      saveProgram(phil, created.id, {
        ...base,
        days: [
          {
            ...base.days[0]!,
            slots: [{ ...base.days[0]!.slots[0]!, incrementKg: 0.3 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a programme nobody could train', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });

    await expect(
      saveProgram(phil, created.id, { name: 'Mein Plan', days: [{ name: 'Leer', slots: [] }] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('forking one from the catalogue', () => {
  it('copies every day and every movement', async () => {
    const ppl = (await programBySlug(pool, 'push_pull_legs'))!;

    const fork = await createProgram(phil, { name: 'PPL, meins', fromProgramId: ppl.id });

    expect(fork.days.map((day) => day.name)).toEqual(ppl.days.map((day) => day.name));
    const original = await slotsFor(phil, ppl.id, ppl.days[1]!.code);
    const copied = await slotsFor(phil, fork.id, fork.days[1]!.code);
    expect(copied.map((s) => s.exerciseName)).toEqual(original.map((s) => s.exerciseName));
  });

  it('gives the fork its own day codes, so the histories stay apart', async () => {
    const ppl = (await programBySlug(pool, 'push_pull_legs'))!;
    const fork = await createProgram(phil, { name: 'PPL, meins', fromProgramId: ppl.id });

    // Same names, and codes derived fresh rather than inherited.
    expect(fork.days.map((d) => d.name)).toEqual(ppl.days.map((d) => d.name));
    expect(fork.id).not.toBe(ppl.id);
  });

  it('copies the catalogue\'s own increments rather than re-deriving them', async () => {
    /**
     * Migration 015 gives the hack squat a 5 kg jump where the squat pattern
     * says 2.5. Before the fork carried them, taking a copy of a built-in
     * quietly halved it — the programme looked identical and progressed at a
     * different rate, which is the worst shape a bug can take here.
     */
    const fullBody = (await programBySlug(pool, 'full_body_3'))!;
    const fork = await createProgram(phil, { name: 'Full body, meins', fromProgramId: fullBody.id });

    const dayC = fork.days.find((day) => day.name === 'Full body C')!;
    const hackSquat = (await slotsFor(phil, fork.id, dayC.code)).find(
      (slot) => slot.exerciseName === 'Hack Squat',
    );

    expect(hackSquat?.incrementKg).toBe(5);
  });
});

describe('a day code is history', () => {
  it('survives a rename, so sessions logged against it are not orphaned', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });
    const saved = await saveProgram(phil, created.id, await draft('Zug'));
    const code = saved.days[0]!.code;

    // Train it once, then rename the day.
    const session = await createSession(phil, { template: code });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Lat Pulldown'),
      setIndex: 1,
      weightKg: 60,
      reps: 8,
    });
    await finishSession(phil, session.id, { rpe: 8 });

    const renamed = await saveProgram(phil, created.id, {
      name: 'Mein Plan',
      days: [{ code, name: 'Rücken', slots: (await draft()).days[0]!.slots }],
    });

    expect(renamed.days[0]).toMatchObject({ code, name: 'Rücken' });
    const { rows } = await pool.query('select template from sessions where id = $1', [session.id]);
    expect(rows[0]?.template).toBe(code);
  });

  it('ignores a code the client invented for a day that never existed', async () => {
    // Otherwise a caller could point an old code at different movements and
    // silently rewrite what those sessions meant.
    const created = await createProgram(phil, { name: 'Mein Plan' });

    const saved = await saveProgram(phil, created.id, {
      name: 'Mein Plan',
      days: [{ code: 'MADEUP', name: 'Zug', slots: (await draft()).days[0]!.slots }],
    });

    expect(saved.days[0]?.code).not.toBe('MADEUP');
    expect(saved.days[0]?.code).toBe('ZUG');
  });
});

describe('whose programme it is', () => {
  it('will not let one athlete edit another\'s', async () => {
    const mine = await createProgram(phil, { name: 'Mein Plan' });

    await expect(saveProgram(sam, mine.id, await draft())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('will not let anybody edit a built-in one', async () => {
    const ppl = (await programBySlug(pool, 'push_pull_legs'))!;

    await expect(saveProgram(phil, ppl.id, await draft())).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('keeps one athlete\'s programmes out of another\'s list', async () => {
    await createProgram(phil, { name: 'Mein Plan' });

    expect((await listPrograms(sam)).map((p) => p.name)).not.toContain('Mein Plan');
  });
});

describe('deleting one', () => {
  it('refuses while it is the one being trained', async () => {
    const created = await createProgram(phil, { name: 'Mein Plan' });
    await saveProgram(phil, created.id, await draft());
    await setProgram(phil, created.id);

    await expect(deleteProgram(phil, created.id)).rejects.toMatchObject({ statusCode: 400 });
    expect((await currentProgram(phil)).id).toBe(created.id);
  });

  it('removes one that is not in use', async () => {
    const created = await createProgram(phil, { name: 'Wegwerfplan' });

    await deleteProgram(phil, created.id);

    expect((await listPrograms(phil)).map((p) => p.name)).not.toContain('Wegwerfplan');
  });
});
