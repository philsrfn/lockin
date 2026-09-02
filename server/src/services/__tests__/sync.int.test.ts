/**
 * The offline sync queue — the riskiest untested code in the repo.
 *
 * The workout logger writes to local SQLite and drains here when the network
 * comes back. That means every op arrives at least once and may arrive twice:
 * a set confirmed in a basement gym, the response lost, the phone retrying on
 * the walk home. It also means a set can reference a session the server has
 * never seen, because both were created offline in the same batch.
 *
 * If this breaks, it breaks silently and it eats training history.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db';
import type { SyncOp } from '../../schemas';
import { exerciseIdByName, isoDaysAgo, resetData, phil } from '../../test/helpers';
import { listSessions } from '../sessions';
import { drain } from '../sync';

beforeEach(resetData);

const createSessionOp = (clientId = randomUUID()): SyncOp => ({
  clientId,
  op: 'create_session',
  payload: { template: 'A' },
});

const recordSetOp = (
  payload: Partial<Extract<SyncOp, { op: 'record_set' }>['payload']> & { exerciseId: number },
  clientId = randomUUID(),
): SyncOp => ({
  clientId,
  op: 'record_set',
  payload: { setIndex: 1, weightKg: 90, reps: 8, ...payload },
});

describe('drain', () => {
  it('applies a batch in order and reports each op', async () => {
    const sessionClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');

    const results = await drain(phil, [
      createSessionOp(sessionClientId),
      recordSetOp({ exerciseId, sessionClientId }),
      { clientId: randomUUID(), op: 'finish_session', payload: { sessionClientId, rpe: 8 } },
    ]);

    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);

    const [session] = await listSessions(phil);
    expect(session?.sets).toHaveLength(1);
    expect(session?.rpe).toBe(8);
  });

  it('resolves a set against a session created in the same batch', async () => {
    const sessionClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');

    await drain(phil, [
      createSessionOp(sessionClientId),
      recordSetOp({ exerciseId, sessionClientId, setIndex: 1 }),
      recordSetOp({ exerciseId, sessionClientId, setIndex: 2 }),
    ]);

    const [session] = await listSessions(phil);
    expect(session?.sets.map((set) => set.setIndex)).toEqual([1, 2]);
  });

  it('replays a whole batch without writing anything twice', async () => {
    const sessionClientId = randomUUID();
    const setClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');
    const batch = [
      createSessionOp(sessionClientId),
      recordSetOp({ exerciseId, sessionClientId }, setClientId),
    ];

    await drain(phil, batch);
    const replay = await drain(phil, batch);

    expect(replay.map((result) => result.status)).toEqual(['duplicate', 'duplicate']);

    const sessions = await listSessions(phil);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sets).toHaveLength(1);
  });

  it('returns the original result on a replay, so the phone can still resolve ids', async () => {
    const clientId = randomUUID();

    const first = await drain(phil, [createSessionOp(clientId)]);
    const second = await drain(phil, [createSessionOp(clientId)]);

    expect(second[0]?.status).toBe('duplicate');
    expect((second[0]?.data as { id: number }).id).toBe((first[0]?.data as { id: number }).id);
  });

  it('does not roll back the sets around one bad op', async () => {
    const sessionClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');

    const results = await drain(phil, [
      createSessionOp(sessionClientId),
      recordSetOp({ exerciseId, sessionClientId, setIndex: 1 }),
      // Exercise 9999 does not exist — a stale local library, say.
      recordSetOp({ exerciseId: 9999, sessionClientId, setIndex: 2 }),
      recordSetOp({ exerciseId, sessionClientId, setIndex: 3 }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'applied',
      'applied',
      'failed',
      'applied',
    ]);

    const [session] = await listSessions(phil);
    expect(session?.sets.map((set) => set.setIndex)).toEqual([1, 3]);
  });

  it('marks a bad payload as not retryable so the phone drops it instead of looping', async () => {
    const sessionClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');

    const [, failure] = await drain(phil, [
      createSessionOp(sessionClientId),
      recordSetOp({ exerciseId: 9999, sessionClientId }),
    ]);

    expect(failure?.status).toBe('failed');
    expect(failure?.retryable).toBe(false);
  });

  it('leaves a failed op out of the log, so a fixed client can retry the same id', async () => {
    const clientId = randomUUID();
    const sessionClientId = randomUUID();
    const exerciseId = await exerciseIdByName('Back Squat');
    await drain(phil, [createSessionOp(sessionClientId)]);

    await drain(phil, [recordSetOp({ exerciseId: 9999, sessionClientId }, clientId)]);
    const retried = await drain(phil, [recordSetOp({ exerciseId, sessionClientId }, clientId)]);

    expect(retried[0]?.status).toBe('applied');
  });

  it('fails a set whose session never synced rather than inventing one', async () => {
    const exerciseId = await exerciseIdByName('Back Squat');

    const [result] = await drain(phil, [recordSetOp({ exerciseId, sessionClientId: randomUUID() })]);

    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('No synced session');
    expect(await listSessions(phil)).toEqual([]);
  });

  it('fails a set that names no session at all', async () => {
    const exerciseId = await exerciseIdByName('Back Squat');

    const [result] = await drain(phil, [recordSetOp({ exerciseId })]);

    expect(result?.error).toContain('Either sessionId or sessionClientId is required');
  });

  it('accepts a server session id directly, for a set queued after the session synced', async () => {
    const exerciseId = await exerciseIdByName('Back Squat');
    const [created] = await drain(phil, [createSessionOp()]);
    const sessionId = (created?.data as { id: number }).id;

    const [result] = await drain(phil, [recordSetOp({ exerciseId, sessionId })]);

    expect(result?.status).toBe('applied');
  });

  it('rolls the op back entirely when its write fails half-way', async () => {
    const sessionClientId = randomUUID();
    await drain(phil, [createSessionOp(sessionClientId)]);

    const [result] = await drain(phil, [
      recordSetOp({ exerciseId: 9999, sessionClientId }, randomUUID()),
    ]);

    expect(result?.status).toBe('failed');
    const { rows } = await pool.query('select id from sets');
    expect(rows).toEqual([]);
  });

  it('syncs a weigh-in queued from the scale in the morning', async () => {
    const [result] = await drain(phil, [
      {
        clientId: randomUUID(),
        op: 'log_weight',
        payload: { measuredOn: isoDaysAgo(1), weightKg: 98.6 },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect((result?.data as { entry: { weightKg: number } }).entry.weightKg).toBe(98.6);
  });

  it('handles an empty batch without complaint', async () => {
    expect(await drain(phil, [])).toEqual([]);
  });

  it('applies two independent sessions from one drain', async () => {
    const first = randomUUID();
    const second = randomUUID();

    await drain(phil, [
      { clientId: first, op: 'create_session', payload: { template: 'A' } },
      { clientId: second, op: 'create_session', payload: { template: 'B' } },
    ]);

    expect((await listSessions(phil)).map((session) => session.template).sort()).toEqual(['A', 'B']);
  });
});
