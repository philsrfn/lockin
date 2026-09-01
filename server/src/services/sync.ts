import type { PoolClient } from 'pg';
import { queryOne, transaction } from '../db';
import { HttpError, badRequest } from '../errors';
import type { SyncOp } from '../schemas';
import { createSession, finishSession } from './sessions';
import { recordSet } from './sets';
import { logWeight } from './bodyweight';

export type SyncResult = {
  clientId: string;
  status: 'applied' | 'duplicate' | 'failed';
  data?: unknown;
  error?: string;
  /** false means the payload is wrong and always will be — drop it, don't loop. */
  retryable?: boolean;
};

/**
 * A set logged offline can reference the session by the client uuid of the
 * create_session op that is queued ahead of it. That op's stored result holds
 * the server id.
 */
async function resolveSessionId(
  reference: { sessionId?: number; sessionClientId?: string },
  db: PoolClient,
): Promise<number> {
  if (reference.sessionId != null) return reference.sessionId;

  if (!reference.sessionClientId) {
    throw badRequest('Either sessionId or sessionClientId is required');
  }

  const { rows } = await db.query<{ result: { id?: number } }>(
    `select result from sync_log where client_id = $1 and op = 'create_session'`,
    [reference.sessionClientId],
  );

  const id = rows[0]?.result?.id;
  if (id == null) {
    throw badRequest(`No synced session for client id ${reference.sessionClientId}`);
  }
  return id;
}

async function execute(op: SyncOp, db: PoolClient): Promise<unknown> {
  switch (op.op) {
    case 'create_session':
      return createSession(op.payload, db);

    case 'record_set': {
      const sessionId = await resolveSessionId(op.payload, db);
      return recordSet({ ...op.payload, sessionId }, db);
    }

    case 'finish_session': {
      const sessionId = await resolveSessionId(op.payload, db);
      return finishSession(sessionId, op.payload, db);
    }

    case 'log_weight':
      return logWeight(op.payload, db);
  }
}

async function applyOne(op: SyncOp): Promise<SyncResult> {
  const seen = await queryOne<{ result: unknown }>(
    'select result from sync_log where client_id = $1',
    [op.clientId],
  );
  if (seen) {
    return { clientId: op.clientId, status: 'duplicate', data: seen.result };
  }

  try {
    const data = await transaction(async (db) => {
      const result = await execute(op, db);
      await db.query(
        `insert into sync_log (client_id, op, result) values ($1, $2, $3)
         on conflict (client_id) do nothing`,
        [op.clientId, op.op, JSON.stringify(result)],
      );
      return result;
    });

    return { clientId: op.clientId, status: 'applied', data };
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    return {
      clientId: op.clientId,
      status: 'failed',
      error: (error as Error).message,
      retryable: status >= 500,
    };
  }
}

/**
 * Drains a batch from the phone. Ops run in order and each gets its own
 * transaction, so one bad row cannot roll back the sets around it — and a
 * client uuid that has already been applied returns its stored result instead
 * of writing twice.
 */
export async function drain(ops: SyncOp[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const op of ops) {
    results.push(await applyOne(op));
  }
  return results;
}
