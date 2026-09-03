/**
 * What the operator needs to see, and the two levers they need to pull.
 *
 * Deliberately read-only apart from approve and revoke. This is a panel for
 * watching a handful of friends and a bill, not a back office — anything that
 * edits an athlete's training belongs in the app, under their own hands.
 *
 * Every query here reads across all users, which is the one place in this
 * codebase that is allowed to. Everything else takes a Ctx and is scoped to
 * one athlete; these take none, and the only caller is behind `requireAdmin`.
 */
import { pool } from '../db';
import { badRequest, notFound } from '../errors';
import { type Rate, costOf, ratesFromEnv, totalCost } from '../domain/pricing';

export const rates = (): Record<string, Rate> => ratesFromEnv(process.env);

export type AthleteRow = {
  id: number;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  approvedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  timezone: string | null;
  locale: string | null;
  onboarded: boolean;
  signInWith: 'apple' | 'token';
  devices: number;
  /** Counts over the trailing week — enough to see whether somebody is using it. */
  sessions7: number;
  sets7: number;
  meals7: number;
  weighIns7: number;
  messages7: number;
  /** Lifetime, so a dormant account still shows what it was. */
  sessionsAll: number;
  calls30: number;
  tokens30: number;
  usd30: number;
  usdAll: number;
  unpricedTokens30: number;
};

/**
 * One row per athlete with their activity and their spend.
 *
 * Written as one statement with lateral subqueries rather than a query per
 * athlete: the row count here is friends, not users, but a panel that fires
 * fifteen queries per refresh is a panel that gets slow the week it matters.
 */
export async function athletes(): Promise<AthleteRow[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `select
       u.id, u.name, u.email, u.is_admin, u.approved_at, u.created_at,
       u.apple_sub is not null as apple,
       p.last_seen_at, p.timezone, p.locale, p.onboarded_at,
       (select count(*) from sessions_tokens t where t.user_id = u.id)::int as devices,
       (select count(*) from sessions s
          where s.user_id = u.id and s.performed_at > now() - interval '7 days')::int as sessions7,
       (select count(*) from sets s
          join sessions se on se.id = s.session_id
          where s.user_id = u.id and se.performed_at > now() - interval '7 days')::int as sets7,
       (select count(*) from meals m
          where m.user_id = u.id and m.eaten_at > now() - interval '7 days')::int as meals7,
       (select count(*) from bodyweight b
          where b.user_id = u.id and b.measured_on > current_date - 7)::int as weigh_ins7,
       (select count(*) from chat_messages c
          where c.user_id = u.id and c.role = 'user'
            and c.created_at > now() - interval '7 days')::int as messages7,
       (select count(*) from sessions s where s.user_id = u.id)::int as sessions_all
     from users u
     left join profile p on p.user_id = u.id
     order by u.id`,
  );

  const spend = await spendByUser();

  return rows.map((row) => {
    const mine = spend.get(row.id as number) ?? EMPTY_SPEND;
    return {
      id: row.id as number,
      name: (row.name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      isAdmin: row.is_admin as boolean,
      approvedAt: iso(row.approved_at),
      createdAt: iso(row.created_at) ?? '',
      lastSeenAt: iso(row.last_seen_at),
      timezone: (row.timezone as string | null) ?? null,
      locale: (row.locale as string | null) ?? null,
      onboarded: row.onboarded_at !== null,
      signInWith: row.apple ? 'apple' : 'token',
      devices: row.devices as number,
      sessions7: row.sessions7 as number,
      sets7: row.sets7 as number,
      meals7: row.meals7 as number,
      weighIns7: row.weigh_ins7 as number,
      messages7: row.messages7 as number,
      sessionsAll: row.sessions_all as number,
      ...mine,
    };
  });
}

type UserSpend = {
  calls30: number;
  tokens30: number;
  usd30: number;
  usdAll: number;
  unpricedTokens30: number;
};

const EMPTY_SPEND: UserSpend = {
  calls30: 0,
  tokens30: 0,
  usd30: 0,
  usdAll: 0,
  unpricedTokens30: 0,
};

/**
 * Priced in code rather than in SQL. The rate table lives in the domain, it is
 * tested, and it is overridable from the environment — none of which survives
 * being written as a CASE expression.
 */
async function spendByUser(): Promise<Map<number, UserSpend>> {
  const { rows } = await pool.query<{
    user_id: number;
    model: string;
    recent: boolean;
    calls: number;
    prompt_tokens: string;
    output_tokens: string;
  }>(
    `select user_id, model,
            day > current_date - 30 as recent,
            sum(calls)::int as calls,
            sum(prompt_tokens) as prompt_tokens,
            sum(output_tokens) as output_tokens
     from llm_usage
     group by user_id, model, recent`,
  );

  const table = rates();
  const spend = new Map<number, UserSpend>();

  for (const row of rows) {
    const current = spend.get(row.user_id) ?? { ...EMPTY_SPEND };
    const promptTokens = Number(row.prompt_tokens);
    const outputTokens = Number(row.output_tokens);
    const priced = costOf({ model: row.model, promptTokens, outputTokens }, table);

    current.usdAll += priced.usd;
    if (row.recent) {
      current.calls30 += row.calls;
      current.tokens30 += promptTokens + outputTokens;
      current.usd30 += priced.usd;
      current.unpricedTokens30 += priced.unpricedTokens;
    }
    spend.set(row.user_id, current);
  }

  return spend;
}

export type DaySpend = {
  day: string;
  calls: number;
  tokens: number;
  usd: number;
};

/** The last `days` days, gaps filled, so a chart has no holes in it. */
export async function spendByDay(days = 30): Promise<DaySpend[]> {
  const { rows } = await pool.query<{
    day: string;
    model: string;
    calls: number;
    prompt_tokens: string;
    output_tokens: string;
  }>(
    `select to_char(day, 'YYYY-MM-DD') as day, model,
            sum(calls)::int as calls,
            sum(prompt_tokens) as prompt_tokens,
            sum(output_tokens) as output_tokens
     from llm_usage
     where day > current_date - $1::int
     group by day, model
     order by day`,
    [days],
  );

  const table = rates();
  const byDay = new Map<string, DaySpend>();

  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { day: row.day, calls: 0, tokens: 0, usd: 0 };
    const promptTokens = Number(row.prompt_tokens);
    const outputTokens = Number(row.output_tokens);

    entry.calls += row.calls;
    entry.tokens += promptTokens + outputTokens;
    entry.usd += costOf({ model: row.model, promptTokens, outputTokens }, table).usd;
    byDay.set(row.day, entry);
  }

  // A day with no calls is a real answer and belongs on the chart as a zero.
  const filled: DaySpend[] = [];
  const today = new Date();
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - back);
    const key = date.toISOString().slice(0, 10);
    filled.push(byDay.get(key) ?? { day: key, calls: 0, tokens: 0, usd: 0 });
  }

  return filled;
}

export type PurposeSpend = {
  purpose: string;
  model: string;
  calls: number;
  tokens: number;
  usd: number;
};

/** Where the money goes: chat, the morning note, the Sunday review, vision. */
export async function spendByPurpose(days = 30): Promise<PurposeSpend[]> {
  const { rows } = await pool.query<{
    purpose: string;
    model: string;
    calls: number;
    prompt_tokens: string;
    output_tokens: string;
  }>(
    `select purpose, model,
            sum(calls)::int as calls,
            sum(prompt_tokens) as prompt_tokens,
            sum(output_tokens) as output_tokens
     from llm_usage
     where day > current_date - $1::int
     group by purpose, model`,
    [days],
  );

  const table = rates();

  return rows
    .map((row) => {
      const promptTokens = Number(row.prompt_tokens);
      const outputTokens = Number(row.output_tokens);
      return {
        purpose: row.purpose,
        model: row.model || '(unrecorded)',
        calls: row.calls,
        tokens: promptTokens + outputTokens,
        usd: costOf({ model: row.model, promptTokens, outputTokens }, table).usd,
      };
    })
    .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
}

export type Overview = {
  athletes: number;
  pending: number;
  activeThisWeek: number;
  usdToday: number;
  usd30: number;
  usdAll: number;
  unpricedTokens: number;
  calls30: number;
  /** Straight-line from the last 7 days. A guess, and labelled as one. */
  projectedMonthlyUsd: number;
  rates: Record<string, Rate>;
};

export async function overview(): Promise<Overview> {
  const [counts, spend] = await Promise.all([
    pool.query<{ athletes: number; pending: number; active: number }>(
      `select count(*)::int as athletes,
              count(*) filter (where approved_at is null)::int as pending,
              (select count(*) from profile
                 where last_seen_at > now() - interval '7 days')::int as active
       from users`,
    ),
    pool.query<{
      day: string;
      model: string;
      calls: number;
      prompt_tokens: string;
      output_tokens: string;
    }>(
      `select to_char(day, 'YYYY-MM-DD') as day, model, sum(calls)::int as calls,
              sum(prompt_tokens) as prompt_tokens, sum(output_tokens) as output_tokens
       from llm_usage group by day, model`,
    ),
  ]);

  const table = rates();
  const today = new Date().toISOString().slice(0, 10);
  const cutoff30 = daysAgo(30);
  const cutoff7 = daysAgo(7);

  let usdToday = 0;
  let usd7 = 0;
  let usd30 = 0;
  let calls30 = 0;
  const all: { model: string; promptTokens: number; outputTokens: number }[] = [];

  for (const row of spend.rows) {
    const promptTokens = Number(row.prompt_tokens);
    const outputTokens = Number(row.output_tokens);
    const priced = costOf({ model: row.model, promptTokens, outputTokens }, table);
    all.push({ model: row.model, promptTokens, outputTokens });

    if (row.day === today) usdToday += priced.usd;
    if (row.day > cutoff7) usd7 += priced.usd;
    if (row.day > cutoff30) {
      usd30 += priced.usd;
      calls30 += row.calls;
    }
  }

  const total = totalCost(all, table);
  const row = counts.rows[0] ?? { athletes: 0, pending: 0, active: 0 };

  return {
    athletes: row.athletes,
    pending: row.pending,
    activeThisWeek: row.active,
    usdToday,
    usd30,
    usdAll: total.usd,
    unpricedTokens: total.unpricedTokens,
    calls30,
    projectedMonthlyUsd: (usd7 / 7) * 30,
    rates: table,
  };
}

export type AdminAction = {
  id: number;
  actor: string;
  subject: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

export async function recentActions(limit = 50): Promise<AdminAction[]> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `select a.id, a.action, a.detail, a.created_at,
            coalesce(actor.name, 'user ' || actor.id) as actor,
            coalesce(subject.name, 'user ' || subject.id) as subject
     from admin_actions a
     join users actor on actor.id = a.actor_id
     left join users subject on subject.id = a.subject_id
     order by a.created_at desc
     limit $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    actor: row.actor as string,
    subject: (row.subject as string | null) ?? null,
    action: row.action as string,
    detail: (row.detail as string | null) ?? null,
    createdAt: iso(row.created_at) ?? '',
  }));
}

/** Approve or revoke. Both are recorded; neither touches anybody's training. */
export async function setApproval(
  actorId: number,
  subjectId: number,
  approved: boolean,
): Promise<void> {
  if (actorId === subjectId && !approved) {
    // Locking yourself out of the panel that grants access is not recoverable
    // from inside the app.
    throw badRequest('You cannot revoke your own account from here.');
  }

  const { rowCount } = await pool.query(
    'update users set approved_at = $2 where id = $1',
    [subjectId, approved ? new Date() : null],
  );
  if (!rowCount) throw notFound(`No user ${subjectId}`);

  // A revoked account keeps its data and loses its sessions: the next request
  // from that phone fails, rather than the account merely being flagged.
  if (!approved) {
    await pool.query('delete from sessions_tokens where user_id = $1', [subjectId]);
  }

  await pool.query(
    'insert into admin_actions (actor_id, subject_id, action) values ($1, $2, $3)',
    [actorId, subjectId, approved ? 'approve' : 'revoke'],
  );
}

/** The per-athlete daily token ceiling, which is the other lever on cost. */
export async function setBudget(
  actorId: number,
  subjectId: number,
  budget: number,
): Promise<void> {
  if (!Number.isInteger(budget) || budget < 0) {
    throw badRequest('A daily token budget is a whole number, or 0 for no ceiling.');
  }

  const { rowCount } = await pool.query(
    'update profile set daily_token_budget = $2 where user_id = $1',
    [subjectId, budget],
  );
  if (!rowCount) throw notFound(`No profile for user ${subjectId}`);

  await pool.query(
    'insert into admin_actions (actor_id, subject_id, action, detail) values ($1, $2, $3, $4)',
    [actorId, subjectId, 'budget', String(budget)],
  );
}

export async function budgets(): Promise<Map<number, number>> {
  const { rows } = await pool.query<{ user_id: number; daily_token_budget: number }>(
    'select user_id, daily_token_budget from profile',
  );
  return new Map(rows.map((row) => [row.user_id, row.daily_token_budget]));
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
