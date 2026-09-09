/**
 * The trainer correcting things, and changing settings.
 *
 * These are the tools that make the plan the athlete's rather than the app's.
 * What is worth testing is the edge each one has: an undo that only ever
 * removes one named entry, a place that cannot be added twice, and a setting
 * that refuses nonsense rather than storing it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { anotherAthlete, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import { runTool } from '../handlers';
import { listContexts } from '../../services/contexts';
import { logMeal, mealsToday } from '../../services/meals';
import { getProfile } from '../../services/profile';
import { createSession } from '../../services/sessions';
import { recordSet } from '../../services/sets';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

const call = (ctx: Ctx, name: string, args: Record<string, unknown> = {}) =>
  runTool(ctx, { id: 'call-1', name, args });

describe('undoing a mis-log', () => {
  it('removes a meal entered twice, and hands back the day', async () => {
    const { meal } = await logMeal(phil, { slot: 'lunch', description: 'Skyr', kcal: 300, proteinG: 30 });
    await logMeal(phil, { slot: 'lunch', description: 'Skyr', kcal: 300, proteinG: 30 });

    const outcome = await call(phil, 'undo_entry', { kind: 'meal', id: meal.id });

    expect(outcome.ok).toBe(true);
    expect(await mealsToday(phil)).toHaveLength(1);
    expect((outcome.consumed as { kcal: number }).kcal).toBe(300);
  });

  it('removes a set typed into the wrong exercise', async () => {
    const session = await createSession(phil, { template: 'A' });
    const { setId } = await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Back Squat'),
      setIndex: 1,
      weightKg: 80,
      reps: 8,
    });

    const outcome = await call(phil, 'undo_entry', { kind: 'set', id: setId });

    expect(outcome.ok).toBe(true);
    expect((outcome.session as { sets: unknown[] }).sets).toHaveLength(0);
  });

  it('refuses anything that is not one of the two', async () => {
    const outcome = await call(phil, 'undo_entry', { kind: 'session', id: 1 });

    expect(outcome.ok).toBe(false);
    expect(outcome.hint).toMatch(/meal.*set/i);
  });

  it('cannot reach into another athlete\'s log', async () => {
    const { meal } = await logMeal(phil, { slot: 'lunch', description: 'Skyr', kcal: 300, proteinG: 30 });

    const outcome = await call(sam, 'undo_entry', { kind: 'meal', id: meal.id });

    expect(outcome.ok).toBe(false);
    expect(await mealsToday(phil)).toHaveLength(1);
  });
});

describe('adding a place', () => {
  it('adds one they mentioned, without switching to it', async () => {
    const outcome = await call(phil, 'add_place', { name: 'Berlin', equipment: ['barbell', 'rack'] });

    expect(outcome.ok).toBe(true);
    const places = await listContexts(phil);
    expect(places.map((place) => place.name)).toContain('Berlin');
    // Switching is a separate decision — they may be adding it for next week.
    expect(places.find((place) => place.name === 'Berlin')?.isActive).toBe(false);
  });

  it('refuses a second place by the same name', async () => {
    await call(phil, 'add_place', { name: 'Berlin' });

    const outcome = await call(phil, 'add_place', { name: 'Berlin' });

    expect(outcome.ok).toBe(false);
  });

  it('records what the place has, because substitutes are filtered by it', async () => {
    await call(phil, 'add_place', { name: 'Hotel', equipment: ['dumbbell'] });

    const hotel = (await listContexts(phil)).find((place) => place.name === 'Hotel');
    expect(hotel?.equipment).toMatchObject({ available: ['dumbbell'] });
  });
});

describe('changing how often they train', () => {
  it('stores it and hands back a fresh view of today', async () => {
    const outcome = await call(phil, 'set_training_days', { days: 5 });

    expect(outcome.ok).toBe(true);
    expect((await getProfile(phil)).trainingDaysPerWeek).toBe(5);
  });

  it('refuses a number nobody trains', async () => {
    expect((await call(phil, 'set_training_days', { days: 0 })).ok).toBe(false);
    expect((await call(phil, 'set_training_days', { days: 9 })).ok).toBe(false);
  });
});
