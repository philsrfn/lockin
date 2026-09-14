/**
 * Which routes are behind the subscription, read off the source.
 *
 * The line between paid and free is a product decision and the easiest kind
 * of thing to get wrong by accident — a route added next to a gated one and
 * not gated, or worse, a gate creeping onto something somebody needs to reach
 * their own data. Neither throws. Both are found here.
 *
 * A static check rather than a request per route, for the same reason
 * `__tests__/tenancy.test.ts` is one: the mistake is an omission, and an
 * omission has no behaviour to observe.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routes = readFileSync(join(import.meta.dirname, '..', 'index.ts'), 'utf8');

/** Everything that reaches a model, and therefore costs money per call. */
const MUST_BE_GATED = [
  "app.post('/chat'",
  "app.post('/coach/today'",
  "app.post('/review/generate'",
  "app.post('/foods/estimate'",
  "app.post('/foods/photo'",
  "app.post('/fridge/read'",
  "app.post('/fridge/plan'",
];

/**
 * Everything somebody must still reach when a subscription has lapsed: their
 * own data, going in and coming out.
 */
const MUST_STAY_OPEN = [
  "app.get('/today'",
  "app.post('/sets'",
  "app.post('/meals'",
  "app.post('/bodyweight'",
  "app.get('/me/export'",
  "app.get('/history'",
  "app.delete('/account'",
];

/** The handler body that follows a route declaration, roughly. */
function handlerAfter(needle: string): string {
  const at = routes.indexOf(needle);
  expect(at, `${needle} is not a route any more — this list needs updating`).toBeGreaterThan(-1);
  return routes.slice(at, at + 400);
}

describe('the subscription gate', () => {
  it('is in front of everything that reaches a model', () => {
    const ungated = MUST_BE_GATED.filter((route) => !handlerAfter(route).includes('requireCoach'));

    expect(ungated, 'these cost money per call and nothing is checking').toEqual([]);
  });

  it('is in front of nothing an athlete needs to reach their own data', () => {
    // Logging, reading and leaving stay free for ever. Holding a training
    // history hostage to force a renewal is how an app gets renewed once.
    const gated = MUST_STAY_OPEN.filter((route) => handlerAfter(route).includes('requireCoach'));

    expect(gated, 'these must work when a subscription has lapsed').toEqual([]);
  });

  it('guards every route that mentions a model, so the list above cannot go stale', () => {
    // Catches the case the two lists cannot: a new route that calls the
    // trainer and was never added to either.
    const missed: string[] = [];
    for (const match of routes.matchAll(/app\.(post|get)\('([^']+)'[\s\S]{0,700}?\n  \}\)/g)) {
      const body = match[0];
      const reachesModel =
        /generateWeeklyReview|sendMessage|noteForToday|estimateFood|readFridgePhoto|generateMealPlan/.test(
          body,
        );
      if (reachesModel && !body.includes('requireCoach')) missed.push(match[2]!);
    }

    expect(missed).toEqual([]);
  });
});
