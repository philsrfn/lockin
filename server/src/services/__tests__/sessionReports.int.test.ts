/**
 * The write-up after a session, against a real database.
 *
 * What the numbers *mean* is covered without a database in
 * `domain/__tests__/sessionReport.test.ts`. What matters here is the reading:
 * which previous outing counts as the one to compare against, what happens
 * when the programme day the session was logged under no longer exists, and
 * that one athlete's report is never built from another's bar.
 *
 * The model itself is not exercised. Nothing in this repository fakes a
 * Gemini call, and the two paths that matter — no trainer access, and a
 * session with nothing in it — both return before the model is reached, so
 * they can be tested honestly without one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import {
  anotherAthlete,
  exerciseIdByName,
  phil,
  resetData,
  resetProfile,
} from '../../test/helpers';
import { createReportFor, factsFor, latestReport, reportFor } from '../sessionReports';
import { createSession, finishSession } from '../sessions';
import { recordSet } from '../sets';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

/** A session with the given sets, finished unless told otherwise. */
async function train(
  ctx: Ctx,
  sets: { exercise?: string; weightKg: number; reps: number }[],
  { finish = true, template = 'A' as string | null, performedAt }: {
    finish?: boolean;
    template?: string | null;
    performedAt?: string;
  } = {},
): Promise<number> {
  const session = await createSession(ctx, {
    template,
    ...(performedAt ? { performedAt } : {}),
  });

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
  return session.id;
}

/** Stores a report without going near a model. */
async function store(ctx: Ctx, sessionId: number, headline: string): Promise<void> {
  await pool.query(
    `insert into session_reports (user_id, session_id, facts, headline, assessment)
     values ($1, $2, $3, $4, $5)`,
    [ctx.userId, sessionId, JSON.stringify({ totalSets: 0 }), headline, 'stored by a test'],
  );
}

describe('gathering the facts', () => {
  it('counts what was actually done', async () => {
    const id = await train(phil, [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
      { exercise: 'Barbell Bench Press', weightKg: 80, reps: 8 },
    ]);

    const { facts } = await factsFor(phil, id);

    expect(facts.totalSets).toBe(3);
    expect(facts.totalReps).toBe(18);
    expect(facts.exerciseCount).toBe(2);
  });

  it('compares each exercise with the last time it was trained', async () => {
    await train(phil, [{ weightKg: 100, reps: 5 }], {
      performedAt: '2026-01-01T10:00:00.000Z',
    });
    const today = await train(phil, [{ weightKg: 105, reps: 5 }], {
      performedAt: '2026-01-08T10:00:00.000Z',
    });

    const { facts } = await factsFor(phil, today);

    expect(facts.exercises[0]?.loadDeltaKg).toBe(5);
  });

  it('has nothing to compare against the first time', async () => {
    const id = await train(phil, [{ weightKg: 100, reps: 5 }]);
    const { facts } = await factsFor(phil, id);

    expect(facts.exercises[0]?.loadDeltaKg).toBeNull();
    expect(facts.versusLast).toBeNull();
  });

  it('never compares against another athlete', async () => {
    await train(sam, [{ weightKg: 200, reps: 5 }], {
      performedAt: '2026-01-01T10:00:00.000Z',
    });
    const mine = await train(phil, [{ weightKg: 100, reps: 5 }], {
      performedAt: '2026-01-08T10:00:00.000Z',
    });

    const { facts } = await factsFor(phil, mine);

    // Sam's 200 kg is heavier than anything Phil has lifted. If it leaked in,
    // it would arrive as a delta rather than as an absence, which is exactly
    // the shape a wrong answer takes when a `user_id` goes missing.
    expect(facts.exercises[0]?.loadDeltaKg).toBeNull();
  });

  it('says nothing about a plan when the day is no longer in the programme', async () => {
    const id = await train(phil, [{ weightKg: 100, reps: 5 }], { template: 'Nonexistent' });
    const { facts } = await factsFor(phil, id);

    expect(facts.plan).toBeNull();
  });

  it('says nothing about a plan for a free session', async () => {
    const id = await train(phil, [{ weightKg: 100, reps: 5 }], { template: null });
    const { facts } = await factsFor(phil, id);

    expect(facts.plan).toBeNull();
  });

  it('refuses a session that is not theirs', async () => {
    const id = await train(sam, [{ weightKg: 100, reps: 5 }]);
    await expect(factsFor(phil, id)).rejects.toThrow();
  });
});

describe('writing one', () => {
  it('writes nothing for a session with no sets', async () => {
    const id = await train(phil, [], { finish: true });
    expect(await createReportFor(phil, id)).toBeNull();
  });

  it('hands back the one already stored rather than generating again', async () => {
    const id = await train(phil, [{ weightKg: 100, reps: 5 }]);
    await store(phil, id, 'the first one');

    // If this reached the model it would either cost a call or throw for want
    // of an API key. Getting the stored headline back is the proof it did not.
    expect(await createReportFor(phil, id)).toMatchObject({ headline: 'the first one' });
  });
});

describe('reading them back', () => {
  it('has none before anything is finished', async () => {
    expect(await latestReport(phil)).toBeNull();
  });

  it('returns the newest', async () => {
    const older = await train(phil, [{ weightKg: 100, reps: 5 }], {
      performedAt: '2026-01-01T10:00:00.000Z',
    });
    const newer = await train(phil, [{ weightKg: 105, reps: 5 }], {
      performedAt: '2026-01-08T10:00:00.000Z',
    });

    await store(phil, older, 'older');
    await store(phil, newer, 'newer');

    expect(await latestReport(phil)).toMatchObject({ headline: 'newer' });
  });

  it('never returns another athlete report', async () => {
    const id = await train(sam, [{ weightKg: 100, reps: 5 }]);
    await store(sam, id, 'sam');

    expect(await reportFor(phil, id)).toBeNull();
    expect(await latestReport(phil)).toBeNull();
  });
});
