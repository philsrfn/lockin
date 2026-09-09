/**
 * What the trainer may do to a programme.
 *
 * The point of these tools is that the plan stops being a preset the athlete
 * has to work around. The point of these tests is the other half: a model
 * writing directly into the thing progression runs on has to fail loudly when
 * it is wrong, not quietly produce a day nobody can train.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { runTool } from '../handlers';
import { currentProgram, listPrograms, programWithSlots } from '../../services/programs';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

const call = (ctx: Ctx, name: string, args: Record<string, unknown> = {}) =>
  runTool(ctx, { id: 'call-1', name, args });

const pullDay = {
  name: 'Zug',
  exercises: [
    { name: 'Lat Pulldown', sets: 4, repMin: 6, repMax: 10 },
    { name: 'Seated Cable Row', sets: 3, repMin: 8, repMax: 12 },
  ],
};

describe('reading the programme', () => {
  it('gives the days and their movements, and what else is on offer', async () => {
    const outcome = await call(phil, 'get_program');

    expect(outcome.ok).toBe(true);
    const current = outcome.current as { days: { name: string; exercises: unknown[] }[] };
    expect(current.days.length).toBeGreaterThan(0);
    expect(current.days[0]?.exercises.length).toBeGreaterThan(0);
    expect((outcome.available as unknown[]).length).toBeGreaterThan(1);
  });
});

describe('switching', () => {
  it('switches by name, loosely enough to be usable', async () => {
    const outcome = await call(phil, 'set_program', { name: 'push / pull / legs' });

    expect(outcome.ok).toBe(true);
    expect((await currentProgram(phil)).name).toBe('Push / Pull / Legs');
  });

  it('refuses a programme that does not exist, and says what does', async () => {
    const outcome = await call(phil, 'set_program', { name: 'Smolov' });

    expect(outcome.ok).toBe(false);
    expect(outcome.hint).toMatch(/Full body|Push/);
  });
});

describe('building one', () => {
  it('creates a programme from the trainer\'s description', async () => {
    const outcome = await call(phil, 'edit_program', {
      name: 'Mit den Jungs',
      days: [pullDay],
    });

    expect(outcome.ok).toBe(true);
    expect((await listPrograms(phil)).map((p) => p.name)).toContain('Mit den Jungs');
  });

  it('copies a built-in one when asked to base it on one', async () => {
    const outcome = await call(phil, 'edit_program', {
      name: 'PPL, angepasst',
      basedOn: 'Push / Pull / Legs',
      days: [pullDay],
    });

    expect(outcome.ok).toBe(true);
    // basedOn seeds it; the days given then replace what was copied.
    const program = outcome.program as { days: { name: string }[] };
    expect(program.days.map((d) => d.name)).toEqual(['Zug']);
  });

  it('refuses a movement it invented, rather than writing a day nobody can train', async () => {
    const outcome = await call(phil, 'edit_program', {
      name: 'Erfunden',
      days: [{ name: 'Tag', exercises: [{ name: 'Hyperbolic Cable Twist', sets: 3, repMin: 8, repMax: 12 }] }],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/not in the exercise library/i);
    expect((await listPrograms(phil)).map((p) => p.name)).not.toContain('Erfunden');
  });

  it('edits the one it already made rather than making a second by the same name', async () => {
    await call(phil, 'edit_program', { name: 'Mein Plan', days: [pullDay] });
    await call(phil, 'edit_program', {
      name: 'Mein Plan',
      days: [pullDay, { name: 'Druck', exercises: [{ name: 'Overhead Press', sets: 3, repMin: 5, repMax: 8 }] }],
    });

    const mine = (await listPrograms(phil)).filter((p) => p.name === 'Mein Plan');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.days.map((d) => d.name)).toEqual(['Zug', 'Druck']);
  });

  it('keeps a day\'s code across an edit, so its sessions stay attached', async () => {
    const first = await call(phil, 'edit_program', { name: 'Mein Plan', days: [pullDay] });
    const code = (first.program as { days: { code: string }[] }).days[0]!.code;

    const second = await call(phil, 'edit_program', {
      name: 'Mein Plan',
      days: [{ ...pullDay, code, name: 'Rücken' }],
    });

    expect((second.program as { days: { code: string; name: string }[] }).days[0]).toMatchObject({
      code,
      name: 'Rücken',
    });
  });

  it('will not touch a built-in programme', async () => {
    const outcome = await call(phil, 'edit_program', { name: 'Full body', days: [pullDay] });

    // A built-in name is not an editable target, so this becomes a programme
    // of their own rather than rewriting the catalogue for everybody.
    expect(outcome.ok).toBe(true);
    // db.ts parses int8 to a number, so this comes back as 1 rather than '1'.
    const { rows } = await pool.query<{ count: number }>(
      "select count(*) from programs where user_id is null and name = 'Full body'",
    );
    expect(rows[0]?.count).toBe(1);
    const builtIn = (await listPrograms(sam)).find((p) => p.name === 'Full body');
    expect(builtIn?.days.map((d) => d.name)).not.toEqual(['Zug']);
  });

  it('never writes into another athlete\'s programme', async () => {
    await call(phil, 'edit_program', { name: 'Mein Plan', days: [pullDay] });

    expect((await listPrograms(sam)).map((p) => p.name)).not.toContain('Mein Plan');
  });

  it('does not let the model set the numbers progression runs on', async () => {
    // §1: increment and rest follow the movement, computed below the model.
    const outcome = await call(phil, 'edit_program', { name: 'Mein Plan', days: [pullDay] });
    const id = (outcome.program as { id: number }).id;

    const [day] = (await programWithSlots(phil, id)).days;
    expect(day?.slots[0]?.incrementKg).toBeGreaterThan(0);
    expect(day?.slots[0]?.restSeconds).toBeGreaterThan(0);
  });
});
