/**
 * Push via Expo's service, which fronts APNs so no certificate lives here.
 *
 * Sending is best-effort by design: a failed nudge must never take down the
 * job that produced it, and it must never block a write. He can always open
 * the app.
 */
import { type Queryable, pool } from './db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushMessage = {
  title: string;
  body: string;
  /** Routed by the app when he taps it. */
  data?: Record<string, unknown>;
};

export async function registerToken(
  token: string,
  platform: string | null,
  db: Queryable = pool,
): Promise<void> {
  await db.query(
    `insert into push_tokens (token, platform) values ($1, $2)
     on conflict (token) do update set last_seen_at = now(), platform = excluded.platform`,
    [token, platform],
  );
}

export async function listTokens(db: Queryable = pool): Promise<string[]> {
  const { rows } = await db.query<{ token: string }>('select token from push_tokens');
  return rows.map((row) => row.token);
}

/** A token Expo tells us is dead is removed, or every send retries it forever. */
async function dropToken(token: string, db: Queryable): Promise<void> {
  await db.query('delete from push_tokens where token = $1', [token]);
}

export async function sendPush(
  message: PushMessage,
  db: Queryable = pool,
): Promise<{ sent: number; failed: number }> {
  const tokens = await listTokens(db);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const payload = tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: 'default',
  }));

  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { sent: 0, failed: tokens.length };
  }

  if (!response.ok) return { sent: 0, failed: tokens.length };

  const result = (await response.json()) as {
    data?: { status: string; details?: { error?: string } }[];
  };

  let sent = 0;
  let failed = 0;
  await Promise.all(
    (result.data ?? []).map(async (entry, index) => {
      if (entry.status === 'ok') {
        sent += 1;
        return;
      }
      failed += 1;
      if (entry.details?.error === 'DeviceNotRegistered') {
        const token = tokens[index];
        if (token) await dropToken(token, db);
      }
    }),
  );

  return { sent, failed };
}
