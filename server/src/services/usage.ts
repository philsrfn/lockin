/**
 * What the trainer costs, and the ceiling on it.
 *
 * The provider has always computed token usage and the app has always thrown
 * it away. With one athlete and a €10 cap on the Google account that was
 * survivable. With a handful of friends it is the one line item that scales
 * with use and has no ceiling of its own, and the failure mode is a bill
 * rather than an error message.
 */
import type { Ctx } from '../db';
import { dayIn } from '../domain/time';
import { HttpError } from '../errors';
import { athleteZone } from './clock';

export type Usage = {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type DailyUsage = {
  day: string;
  calls: number;
  tokens: number;
  budget: number;
  remaining: number;
};

export async function usageToday(ctx: Ctx, zone?: string): Promise<DailyUsage> {
  const day = dayIn(zone ?? (await athleteZone(ctx)));

  const { rows } = await ctx.db.query<{
    calls: number;
    tokens: number;
    budget: number;
  }>(
    `select coalesce(sum(u.calls), 0)::int as calls,
            coalesce(sum(u.prompt_tokens + u.output_tokens), 0)::int as tokens,
            p.daily_token_budget as budget
     from profile p
     left join llm_usage u on u.user_id = p.user_id and u.day = $2::date
     where p.user_id = $1
     group by p.daily_token_budget`,
    [ctx.userId, day],
  );

  const row = rows[0] ?? { calls: 0, tokens: 0, budget: 0 };
  return {
    day,
    calls: row.calls,
    tokens: row.tokens,
    budget: row.budget,
    remaining: Math.max(0, row.budget - row.tokens),
  };
}

export async function recordUsage(
  ctx: Ctx,
  purpose: string,
  usage: Usage,
  model = '',
  zone?: string,
): Promise<void> {
  const day = dayIn(zone ?? (await athleteZone(ctx)));

  await ctx.db.query(
    `insert into llm_usage (user_id, day, purpose, model, calls, prompt_tokens, output_tokens)
     values ($1, $2::date, $3, $4, 1, $5, $6)
     on conflict (user_id, day, purpose, model) do update set
       calls = llm_usage.calls + 1,
       prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens,
       output_tokens = llm_usage.output_tokens + excluded.output_tokens,
       updated_at = now()`,
    [ctx.userId, day, purpose, model, usage.promptTokens, usage.outputTokens],
  );
}

/**
 * Checked before a call rather than after, because after is a bill. A budget
 * of 0 means unlimited — the same escape hatch a cron job needs and the one
 * Phil's own account keeps.
 */
export async function assertWithinBudget(ctx: Ctx, zone?: string): Promise<void> {
  const usage = await usageToday(ctx, zone);
  if (usage.budget === 0 || usage.remaining > 0) return;

  throw new HttpError(
    429,
    "That is today's allowance for the trainer used up. It resets at midnight, " +
      'and everything else in the app — logging, the plan, your numbers — keeps working.',
  );
}
