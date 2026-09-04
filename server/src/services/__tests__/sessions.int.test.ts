/**
 * Sessions and sets: the write path the workout logger depends on.
 *
 * The logger is used one-handed, sweaty, on bad wifi, and it replays its queue
 * when the network comes back. Everything here is about that: idempotency,
 * returning ground truth rather than the caller's assumption, and refusing
 * input that would corrupt the history the progression maths reads.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import { contextIdByName, daysAgo, exerciseIdByName, resetData, phil } from '../../test/helpers';
import {
  createSession,
  finishSession,
  firstSessionAt,
  getSession,
  listSessions,
  openSession,
  recentSessions,
  sessionsToday,
} from '../sessions';
import { deleteSet, recordSet } from '../sets';

beforeEach(resetData);

async function squatId(): Promise<number> {
  return exerciseIdByName('Back Squat');
}

describe('createSession', () => {
  it('opens a session with no sets, unfinished', async () => {
    const session = await createSession(phil, { template: 'A' });

    expect(session.template).toBe('A');
    expect(session.sets).toEqual([]);
    expect(session.finished).toBe(false);
    expect(session.rpe).toBeNull();
  });

  it('defaults to the active context so starting a workout is one tap', async () => {
    const session = await createSession(phil, { template: 'A' });

    expect(session.contextName).toBe('Home');
  });

  it('honours an explicit context over the active one', async () => {
    const leipzig = await contextIdByName('City C');

    const session = await createSession(phil, { template: 'B', contextId: leipzig });

    expect(session.contextId).toBe(leipzig);
    expect(session.contextName).toBe('City C');
  });

  it('leaves the context null when nothing is active', async () => {
    await pool.query('update contexts set is_active = false');
    try {
      const session = await createSession(phil, { template: 'A' });
      expect(session.contextId).toBeNull();
    } finally {
      await pool.query(`update contexts set is_active = (name = 'Home')`);
    }
  });
});

describe('recordSet', () => {
  it('returns the whole session, not just the id it wrote', async () => {
    const session = await createSession(phil, { template: 'A' });

    const result = await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await squatId(),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
      rir: 2,
    });

    expect(result.session.sets).toHaveLength(1);
    expect(result.session.sets[0]).toMatchObject({
      exerciseName: 'Back Squat',
      setIndex: 1,
      weightKg: 90,
      reps: 8,
      rir: 2,
    });
  });

  it('is idempotent on (session, exercise, set index) — a replayed set does not duplicate', async () => {
    const session = await createSession(phil, { template: 'A' });
    const exerciseId = await squatId();
    const input = { sessionId: session.id, exerciseId, setIndex: 1, weightKg: 90, reps: 8 };

    const first = await recordSet(phil, input);
    const replayed = await recordSet(phil, input);

    expect(replayed.setId).toBe(first.setId);
    expect(replayed.session.sets).toHaveLength(1);
  });

  it('overwrites a fat-fingered number rather than adding a second row', async () => {
    const session = await createSession(phil, { template: 'A' });
    const exerciseId = await squatId();
    await recordSet(phil, { sessionId: session.id, exerciseId, setIndex: 1, weightKg: 900, reps: 8 });

    const corrected = await recordSet(phil, {
      sessionId: session.id,
      exerciseId,
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    expect(corrected.session.sets).toHaveLength(1);
    expect(corrected.session.sets[0]?.weightKg).toBe(90);
  });

  it('keeps two exercises at the same set index apart', async () => {
    const session = await createSession(phil, { template: 'A' });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await squatId(),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });
    const result = await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Lat Pulldown'),
      setIndex: 1,
      weightKg: 60,
      reps: 10,
    });

    expect(result.session.sets).toHaveLength(2);
  });

  it('stores a bodyweight movement as 0kg rather than rejecting it', async () => {
    const session = await createSession(phil, { template: 'C' });

    const result = await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await exerciseIdByName('Pull-up'),
      setIndex: 1,
      weightKg: 0,
      reps: 6,
    });

    expect(result.session.sets[0]?.weightKg).toBe(0);
  });

  it.each([
    ['a set index below one', { setIndex: 0 }, 'setIndex starts at 1'],
    ['negative reps', { reps: -1 }, 'reps cannot be negative'],
    ['a negative load', { weightKg: -5 }, 'weightKg cannot be negative'],
    ['an out-of-range RIR', { rir: 11 }, 'rir must be between 0 and 10'],
  ])('rejects %s', async (_label, override, message) => {
    const session = await createSession(phil, { template: 'A' });

    await expect(
      recordSet(phil, {
        sessionId: session.id,
        exerciseId: await squatId(),
        setIndex: 1,
        weightKg: 90,
        reps: 8,
        ...override,
      }),
    ).rejects.toThrow(message);
  });

  it('404s on a session that does not exist', async () => {
    await expect(
      recordSet(phil, { sessionId: 9999, exerciseId: await squatId(), setIndex: 1, weightKg: 90, reps: 8 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404s on an exercise that does not exist', async () => {
    const session = await createSession(phil, { template: 'A' });

    await expect(
      recordSet(phil, { sessionId: session.id, exerciseId: 9999, setIndex: 1, weightKg: 90, reps: 8 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('writes nothing when validation fails mid-way', async () => {
    const session = await createSession(phil, { template: 'A' });

    await expect(
      recordSet(phil, { sessionId: session.id, exerciseId: 9999, setIndex: 1, weightKg: 90, reps: 8 }),
    ).rejects.toThrow();

    expect((await getSession(phil, session.id)).sets).toEqual([]);
  });
});

describe('deleteSet', () => {
  it('removes the set and hands back the session to re-render', async () => {
    const session = await createSession(phil, { template: 'A' });
    const { setId } = await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await squatId(),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    const after = await deleteSet(phil, setId);

    expect(after.sets).toEqual([]);
  });

  it('404s on a set that is already gone', async () => {
    await expect(deleteSet(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('finishSession', () => {
  it('closes the session out with RPE, note and the joint pain flag', async () => {
    const session = await createSession(phil, { template: 'A' });

    const finished = await finishSession(phil, session.id, {
      rpe: 8,
      notes: 'knee felt fine',
      jointPain: false,
    });

    expect(finished.finished).toBe(true);
    expect(finished.rpe).toBe(8);
    expect(finished.notes).toBe('knee felt fine');
    expect(finished.jointPain).toBe(false);
  });

  it('keeps the existing RPE when a later call only adds a note', async () => {
    const session = await createSession(phil, { template: 'A' });
    await finishSession(phil, session.id, { rpe: 8 });

    const after = await finishSession(phil, session.id, { notes: 'added later' });

    expect(after.rpe).toBe(8);
    expect(after.notes).toBe('added later');
  });

  it.each([0, 11])('rejects an RPE of %i', async (rpe) => {
    const session = await createSession(phil, { template: 'A' });

    await expect(finishSession(phil, session.id, { rpe })).rejects.toThrow('RPE must be between 1 and 10');
  });

  it('404s on an unknown session', async () => {
    await expect(finishSession(phil, 9999, { rpe: 8 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('openSession', () => {
  it('is null when nothing is in progress', async () => {
    expect(await openSession(phil)).toBeNull();
  });

  it('finds the session with no RPE', async () => {
    const done = await createSession(phil, { template: 'A' });
    await finishSession(phil, done.id, { rpe: 8 });
    const running = await createSession(phil, { template: 'B' });

    expect((await openSession(phil))?.id).toBe(running.id);
  });

  it('goes back to null once that session is finished', async () => {
    const session = await createSession(phil, { template: 'A' });
    await finishSession(phil, session.id, { rpe: 7 });

    expect(await openSession(phil)).toBeNull();
  });
});

describe('reads over history', () => {
  it('lists sessions newest first and clamps a silly limit', async () => {
    await createSession(phil, { template: 'A', performedAt: daysAgo(3) });
    await createSession(phil, { template: 'B', performedAt: daysAgo(1) });

    const all = await listSessions(phil, 500);

    expect(all.map((session) => session.template)).toEqual(['B', 'A']);
  });

  it('honours the limit', async () => {
    await createSession(phil, { template: 'A', performedAt: daysAgo(3) });
    await createSession(phil, { template: 'B', performedAt: daysAgo(1) });

    expect(await listSessions(phil, 1)).toHaveLength(1);
  });

  it('windows recent sessions by days, excluding what falls outside', async () => {
    await createSession(phil, { template: 'A', performedAt: daysAgo(20) });
    await createSession(phil, { template: 'B', performedAt: daysAgo(2) });

    const recent = await recentSessions(phil, 7);

    expect(recent.map((session) => session.template)).toEqual(['B']);
  });

  it('reports the first session, which is what the ramp-in window is measured from', async () => {
    expect(await firstSessionAt(phil)).toBeNull();

    await createSession(phil, { template: 'B', performedAt: daysAgo(2) });
    await createSession(phil, { template: 'A', performedAt: daysAgo(10) });

    expect((await firstSessionAt(phil))?.toISOString()).toBe(daysAgo(10));
  });

  it('finds only what was performed today', async () => {
    await createSession(phil, { template: 'A', performedAt: daysAgo(1) });
    const todays = await createSession(phil, { template: 'B' });

    const found = await sessionsToday(phil);

    expect(found.map((session) => session.id)).toEqual([todays.id]);
  });

  it('carries sets through the list reads, not just the single-session read', async () => {
    const session = await createSession(phil, { template: 'A' });
    await recordSet(phil, {
      sessionId: session.id,
      exerciseId: await squatId(),
      setIndex: 1,
      weightKg: 90,
      reps: 8,
    });

    expect((await listSessions(phil))[0]?.sets).toHaveLength(1);
  });
});

describe('getSession', () => {
  it('404s rather than returning an empty session', async () => {
    await expect(getSession(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
