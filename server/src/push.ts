/**
 * Push via Expo's service, which fronts APNs so no certificate lives here.
 *
 * Sending is best-effort by design: a failed nudge must never take down the
 * job that produced it, and it must never block a write. He can always open
 * the app.
 */
import type { Ctx } from './db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushMessage = {
  title: string;
  body: string;
  /** Routed by the app when he taps it. */
  data?: Record<string, unknown>;
};

export async function registerToken(
  ctx: Ctx,
  token: string,
  platform: string | null,
): Promise<void> {
  // A reinstall issues a new token; the same token arriving under a different
  // user means the device changed hands, and it should follow the device.
  await ctx.db.query(
    `insert into push_tokens (user_id, token, platform) values ($1, $2, $3)
     on conflict (token) do update
       set last_seen_at = now(), platform = excluded.platform, user_id = excluded.user_id`,
    [ctx.userId, token, platform],
  );
}

export async function listTokens(ctx: Ctx): Promise<string[]> {
  const { rows } = await ctx.db.query<{ token: string }>(
    'select token from push_tokens where user_id = $1',
    [ctx.userId],
  );
  return rows.map((row) => row.token);
}

/** A token Expo tells us is dead is removed, or every send retries it forever. */
async function dropToken(ctx: Ctx, token: string): Promise<void> {
  await ctx.db.query('delete from push_tokens where token = $1 and user_id = $2', [
    token,
    ctx.userId,
  ]);
}

/**
 * Addressed, never broadcast. Before this every push went to every registered
 * device in the system — a second user would have received Phil's 07:30 nudge.
 */
export async function sendPush(
  ctx: Ctx,
  message: PushMessage,
): Promise<{ sent: number; failed: number }> {
  const tokens = await listTokens(ctx);
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
        if (token) await dropToken(ctx, token);
      }
    }),
  );

  return { sent, failed };
}
