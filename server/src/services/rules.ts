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

/**
 * Editing a rule's wording or scope. A rule with a `code` is enforced by the
 * validator (§5) — its wording is what Phil reads, but the check behind it is
 * fixed in code, so the tier stays put. Letting him downgrade "never propose a
 * day under 160g protein" from `never` to `soft` in a text field would quietly
 * disarm a safety floor.
 */
export async function updateRule(
  id: number,
  input: { tier?: RuleTier; text?: string; scope?: string | null; active?: boolean },
  db: Queryable = pool,
): Promise<Rule> {
  const { rows: existing } = await db.query<RuleRow>(
    'select id, tier, text, scope, code, active from rules where id = $1',
    [id],
  );
  const current = existing[0];
  if (!current) throw notFound(`No rule ${id}`);

  if (input.tier && !['hard', 'soft', 'never'].includes(input.tier)) {
    throw badRequest('tier must be hard, soft or never');
  }
  if (input.text !== undefined && !input.text.trim()) {
    throw badRequest('A rule needs text');
  }
  if (current.code && input.tier && input.tier !== current.tier) {
    throw badRequest(
      'That rule is enforced in code, so its tier cannot change. Reword it or deactivate it.',
    );
  }

  const { rows } = await db.query<RuleRow>(
    `update rules
     set tier = $2, text = $3, scope = $4, active = $5
     where id = $1
     returning id, tier, text, scope, code, active`,
    [
      id,
      input.tier ?? current.tier,
      input.text?.trim() ?? current.text,
      input.scope === undefined ? current.scope : input.scope,
      input.active ?? current.active,
    ],
  );
  return toRule(rows[0]!);
}
