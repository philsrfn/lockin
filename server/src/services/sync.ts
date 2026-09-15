import { type Ctx, transactionFor } from '../db';
import { HttpError, badRequest } from '../errors';
import type { SyncOp } from '../schemas';
import { createSession, finishSession } from './sessions';
import { reportInBackground } from './sessionReports';
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
  ctx: Ctx,
  reference: { sessionId?: number; sessionClientId?: string },
): Promise<number> {
  if (reference.sessionId != null) return reference.sessionId;

  if (!reference.sessionClientId) {
    throw badRequest('Either sessionId or sessionClientId is required');
  }

  const { rows } = await ctx.db.query<{ result: { id?: number } }>(
    `select result from sync_log
     where user_id = $1 and client_id = $2 and op = 'create_session'`,
    [ctx.userId, reference.sessionClientId],
  );

  const id = rows[0]?.result?.id;
  if (id == null) {
    throw badRequest(`No synced session for client id ${reference.sessionClientId}`);
  }
  return id;
}

async function execute(ctx: Ctx, op: SyncOp): Promise<unknown> {
  switch (op.op) {
    case 'create_session':
      return createSession(ctx, op.payload);

    case 'record_set': {
      const sessionId = await resolveSessionId(ctx, op.payload);
      return recordSet(ctx, { ...op.payload, sessionId });
    }

    case 'finish_session': {
      const sessionId = await resolveSessionId(ctx, op.payload);
      return finishSession(ctx, sessionId, op.payload);
    }

    case 'log_weight':
      return logWeight(ctx, op.payload);
  }
}

async function applyOne(ctx: Ctx, op: SyncOp): Promise<SyncResult> {
  // Scoped by user: a client uuid is generated on a phone, and two phones
  // colliding on one must not hand the second person the first one's result.
  const { rows: seen } = await ctx.db.query<{ result: unknown }>(
    'select result from sync_log where user_id = $1 and client_id = $2',
    [ctx.userId, op.clientId],
  );
  if (seen[0]) {
    return { clientId: op.clientId, status: 'duplicate', data: seen[0].result };
  }

  try {
    const data = await transactionFor(ctx, async (inner) => {
      const result = await execute(inner, op);
      await inner.db.query(
        `insert into sync_log (user_id, client_id, op, result) values ($1, $2, $3, $4)
         on conflict (user_id, client_id) do nothing`,
        [inner.userId, op.clientId, op.op, JSON.stringify(result)],
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
export async function drain(ctx: Ctx, ops: SyncOp[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const finished: number[] = [];

  for (const op of ops) {
    const result = await applyOne(ctx, op);
    results.push(result);

    // `applied` and not `duplicate`: a duplicate means this finish has been
    // seen before, and the report it produced is already written. Reacting to
    // it again would cost a model call to discover the unique constraint.
    if (op.op === 'finish_session' && result.status === 'applied') {
      const session = result.data as { id?: number; rpe?: number | null } | undefined;
      // No RPE means the update coalesced to nothing and the session is still
      // open — `finishedSql` is the authority on that, and it reads rpe.
      if (session?.id != null && session.rpe != null) finished.push(session.id);
    }
  }

  /**
   * After the whole batch, not after the op.
   *
   * A queue that has been waiting for signal drains everything it has in one
   * request, and the order within it is the order things happened on the
   * phone — but a report that starts reading while later ops are still
   * committing would describe a session that is missing its last sets. The
   * cost of waiting is the few hundred milliseconds the rest of the batch
   * takes; the cost of not waiting is a write-up that is quietly wrong.
   */
  for (const id of finished) reportInBackground(ctx.userId, id);

  return results;
}
