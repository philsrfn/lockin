import { type Queryable, pool } from '../db';
import { badRequest, notFound } from '../errors';
import type { Rule, RuleTier } from '../rules/schema';

type RuleRow = {
  id: number;
  tier: string;
  text: string;
  scope: string | null;
  code: string | null;
  active: boolean;
};

const toRule = (row: RuleRow): Rule => ({
  id: row.id,
  tier: row.tier as RuleTier,
  text: row.text,
  scope: row.scope,
  code: row.code,
  active: row.active,
});

export async function listRules(db: Queryable = pool): Promise<Rule[]> {
  const { rows } = await db.query<RuleRow>(
    'select id, tier, text, scope, code, active from rules order by tier, id',
  );
  return rows.map(toRule);
}

/**
 * A rule Phil adds in conversation has no code, so the validator cannot enforce
 * it — it reaches the model in the system instruction instead. Making that up
 * silently would be worse than saying it.
 */
export async function addRule(
  input: { tier: RuleTier; text: string; scope?: string | null },
  db: Queryable = pool,
): Promise<{ rule: Rule; enforceable: boolean }> {
  if (!['hard', 'soft', 'never'].includes(input.tier)) {
    throw badRequest('tier must be hard, soft or never');
  }
  if (!input.text?.trim()) throw badRequest('A rule needs text');

  const { rows } = await db.query<RuleRow>(
    `insert into rules (tier, text, scope, active) values ($1, $2, $3, true)
     returning id, tier, text, scope, code, active`,
    [input.tier, input.text.trim(), input.scope ?? null],
  );

  return { rule: toRule(rows[0]!), enforceable: false };
}

export async function deactivateRule(id: number, db: Queryable = pool): Promise<Rule> {
  const { rows } = await db.query<RuleRow>(
    `update rules set active = false where id = $1
     returning id, tier, text, scope, code, active`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound(`No rule ${id}`);
  return toRule(row);
}
