/**
 * The admin panel's routes.
 *
 * Every one of these is behind `requireAdmin`, which answers 404 rather than
 * 403 to anybody else — there is no reason to confirm to a signed-in athlete
 * that a panel exists.
 *
 * The one exception is `GET /admin`, the page itself. A browser cannot put an
 * Authorization header on its own document request, so the HTML is a shell:
 * a token box and the script that fetches everything else. It carries no data.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth';
import { adminPage } from '../admin/page';
import {
  athletes,
  budgets,
  overview,
  recentActions,
  setApproval,
  setBudget,
  spendByDay,
  spendByPurpose,
} from '../services/admin';

const ApprovalSchema = z.object({ approved: z.boolean() });
const BudgetSchema = z.object({ budget: z.number().int().min(0).max(100_000_000) });
const IdSchema = z.object({ id: z.coerce.number().int().positive() });

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get('/admin', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(adminPage());
  });

  /**
   * Everything the page draws, in one request. Several small endpoints would
   * be tidier and would also mean the panel renders in pieces on a bad
   * connection, which is when somebody is most likely to be checking it.
   */
  app.get('/admin/data', async (request) => {
    requireAdmin(request);

    const [head, rows, byDay, byPurpose, actions, budget] = await Promise.all([
      overview(),
      athletes(),
      spendByDay(30),
      spendByPurpose(30),
      recentActions(40),
      budgets(),
    ]);

    return {
      overview: head,
      athletes: rows.map((row) => ({ ...row, dailyTokenBudget: budget.get(row.id) ?? 0 })),
      spendByDay: byDay,
      spendByPurpose: byPurpose,
      actions,
      generatedAt: new Date().toISOString(),
    };
  });

  app.post('/admin/users/:id/approval', async (request) => {
    const admin = requireAdmin(request);
    const { id } = IdSchema.parse(request.params);
    const { approved } = ApprovalSchema.parse(request.body);

    await setApproval(admin.id, id, approved);
    return { athletes: await athletes() };
  });

  app.post('/admin/users/:id/budget', async (request) => {
    const admin = requireAdmin(request);
    const { id } = IdSchema.parse(request.params);
    const { budget } = BudgetSchema.parse(request.body);

    await setBudget(admin.id, id, budget);
    return { athletes: await athletes() };
  });
}
