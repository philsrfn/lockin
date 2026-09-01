/**
 * The offline queue. Every write the app makes is appended here and drained to
 * POST /sync when the network allows.
 *
 * There is no connectivity library: a failed request *is* the offline signal,
 * and retry handles the rest. Drains are triggered after every write, when the
 * app comes to the foreground, and on a timer while the queue is not empty.
 *
 * Nothing is ever deleted silently. An op the server permanently rejects is
 * marked dead and kept, because a set that vanishes without telling anyone is
 * worse than no offline support at all.
 */
import { AppState } from 'react-native';
import { api } from '../api/client';
import { database, setSessionServerId } from '../db/local';

export type QueuedOp =
  | { op: 'create_session'; payload: { template: string; performedAt?: string } }
  | {
      op: 'record_set';
      payload: {
        sessionId?: number;
        sessionClientId?: string;
        exerciseId: number;
        setIndex: number;
        weightKg: number;
        reps: number;
        rir?: number | null;
      };
    }
  | {
      op: 'finish_session';
      payload: {
        sessionId?: number;
        sessionClientId?: string;
        rpe?: number;
        jointPain?: boolean;
        notes?: string | null;
      };
    }
  | { op: 'log_weight'; payload: { weightKg: number; measuredOn?: string } };

type QueueRow = { client_id: string; op: string; payload: string };

type SyncResult = {
  clientId: string;
  status: 'applied' | 'duplicate' | 'failed';
  data?: unknown;
  error?: string;
  retryable?: boolean;
};

export type QueueSnapshot = {
  /** Waiting to be sent, or sent and rejected in a way worth retrying. */
  pending: Set<string>;
  /** Permanently rejected. Kept on the phone, surfaced in the UI. */
  dead: Set<string>;
};

// `create table if not exists` above will not add a column to an install that
// predates it, so this runs unconditionally and is allowed to fail.
try {
  database.execSync('alter table sync_queue add column dead integer not null default 0');
} catch {
  // Column already exists.
}

const listeners = new Set<(snapshot: QueueSnapshot) => void>();
let draining = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function snapshot(): QueueSnapshot {
  const rows = database.getAllSync<{ client_id: string; dead: number }>(
    'select client_id, dead from sync_queue',
  );
  return {
    pending: new Set(rows.filter((row) => row.dead === 0).map((row) => row.client_id)),
    dead: new Set(rows.filter((row) => row.dead === 1).map((row) => row.client_id)),
  };
}

function notify(): void {
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

export function subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

/** Append a write. Returns immediately — the drain happens in the background. */
export function enqueue(clientId: string, entry: QueuedOp): void {
  database.runSync(
    `insert or replace into sync_queue (client_id, op, payload, created_at, dead)
     values (?, ?, ?, ?, 0)`,
    [clientId, entry.op, JSON.stringify(entry.payload), new Date().toISOString()],
  );
  notify();
  void drain();
}

/** Retry an op the server rejected, after the cause has been fixed. */
export function revive(clientId: string): void {
  database.runSync('update sync_queue set dead = 0, attempts = 0 where client_id = ?', [clientId]);
  notify();
  void drain();
}

export async function drain(): Promise<{ sent: number; dead: number; kept: number }> {
  if (draining) return { sent: 0, dead: 0, kept: 0 };
  draining = true;

  try {
    const rows = database.getAllSync<QueueRow>(
      'select client_id, op, payload from sync_queue where dead = 0 order by created_at limit 100',
    );
    if (rows.length === 0) return { sent: 0, dead: 0, kept: 0 };

    const ops = rows.map((row) => ({
      clientId: row.client_id,
      op: row.op,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));

    let response: { results: SyncResult[] };
    try {
      response = await api<{ results: SyncResult[] }>('/sync', { method: 'POST', body: { ops } });
    } catch {
      // Still offline. Everything stays queued, untouched.
      database.runSync(
        `update sync_queue set attempts = attempts + 1
         where client_id in (${rows.map(() => '?').join(',')})`,
        rows.map((row) => row.client_id),
      );
      return { sent: 0, dead: 0, kept: rows.length };
    }

    let sent = 0;
    let dead = 0;
    let kept = 0;

    for (const result of response.results) {
      if (result.status === 'applied' || result.status === 'duplicate') {
        // A create_session hands back the server id that later ops referenced
        // by client uuid; record it so the rest of the app can use it.
        const data = result.data as { id?: number } | undefined;
        if (data?.id != null) setSessionServerId(result.clientId, data.id);

        database.runSync('delete from sync_queue where client_id = ?', [result.clientId]);
        sent += 1;
        continue;
      }

      if (result.retryable === false) {
        // Wrong payload; retrying forever would block every write behind it.
        // Kept and flagged rather than dropped — the set is still on the phone
        // and the screen says so.
        database.runSync(
          'update sync_queue set dead = 1, last_error = ? where client_id = ?',
          [result.error ?? 'rejected', result.clientId],
        );
        console.warn(`sync: ${result.clientId} rejected: ${result.error}`);
        dead += 1;
        continue;
      }

      database.runSync(
        'update sync_queue set attempts = attempts + 1, last_error = ? where client_id = ?',
        [result.error ?? null, result.clientId],
      );
      kept += 1;
    }

    notify();
    return { sent, dead, kept };
  } finally {
    draining = false;
  }
}

/** Foreground and a slow heartbeat while anything is waiting. */
export function startAutoDrain(): () => void {
  void drain();

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void drain();
  });

  timer = setInterval(() => {
    if (snapshot().pending.size > 0) void drain();
  }, 15_000);

  return () => {
    subscription.remove();
    if (timer) clearInterval(timer);
    timer = null;
  };
}
