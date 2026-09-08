/**
 * Personal bests against a real database.
 *
 * The comparison rules are covered without a database in
 * `domain/__tests__/records.test.ts`. What matters here is which sets are
 * eligible at all — an unfinished session's sets are not — and that one
 * athlete's bests are never built from another's bar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { anotherAthlete, exerciseIdByName, phil, resetData, resetProfile } from '../../test/helpers';
import { bestsFor, personalBests } from '../records';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

/** A session with the given sets. Left open unless `finish` says otherwise. */
async function train(
  ctx: Ctx,
  sets: { exercise?: string; weightKg: number; reps: number }[],
  { finish = true } = {},
): Promise<void> {
  const session = await createSession(ctx, { template: 'A' });
  let index = 1;
  for (const set of sets) {
    await recordSet(ctx, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName(set.exercise ?? 'Back Squat'),
      setIndex: index,
      weightKg: set.weightKg,
      reps: set.reps,
    });
    index += 1;
  }
  if (finish) await finishSession(ctx, session.id, { rpe: 8 });
}

describe('reading personal bests', () => {
  it('has none for somebody who has not lifted', async () => {
    expect(await personalBests(phil)).toEqual([]);
  });

  it('separates the heaviest set from the best one', async () => {
    await train(phil, [
      { weightKg: 110, reps: 3 },
      { weightKg: 100, reps: 8 },
    ]);

    const [bests] = await personalBests(phil);

    expect(bests?.heaviest).toMatchObject({ weightKg: 110, reps: 3 });
    expect(bests?.strongest).toMatchObject({ weightKg: 100, reps: 8 });
  });

  it('reports each movement separately', async () => {
    await train(phil, [
      { weightKg: 100, reps: 5 },
      { exercise: 'Barbell Bench Press', weightKg: 80, reps: 5 },
    ]);

    expect((await personalBests(phil)).map((b) => b.exerciseName).sort()).toEqual([
      'Back Squat',
      'Barbell Bench Press',
    ]);
  });

  it('ignores a session still in progress', async () => {
    // A set logged and then taken back because the bar slipped must not stand
    // as a record for the rest of the session.
    await train(phil, [{ weightKg: 200, reps: 5 }], { finish: false });

    expect(await personalBests(phil)).toEqual([]);
  });

  it('counts a session once it is closed out', async () => {
    await train(phil, [{ weightKg: 120, reps: 5 }]);

    expect((await personalBests(phil))[0]?.heaviest.weightKg).toBe(120);
  });

  it('answers for a single movement without loading the rest', async () => {
    await train(phil, [
      { weightKg: 100, reps: 5 },
      { exercise: 'Barbell Bench Press', weightKg: 80, reps: 5 },
    ]);

    const squat = await bestsFor(phil, await exerciseIdByName('Back Squat'));

    expect(squat?.heaviest.weightKg).toBe(100);
    expect(await bestsFor(phil, await exerciseIdByName('Lat Pulldown'))).toBeNull();
  });

  it('never builds one athlete\'s record out of another\'s bar', async () => {
    await train(phil, [{ weightKg: 140, reps: 5 }]);
    await train(sam, [{ weightKg: 60, reps: 5 }]);

    expect((await personalBests(sam))[0]?.heaviest.weightKg).toBe(60);
    expect((await personalBests(phil))[0]?.heaviest.weightKg).toBe(140);
  });
});
