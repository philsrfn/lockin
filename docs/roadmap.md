# What is left

Audited against [CLAUDE.md](../CLAUDE.md) on 2026-09-04, by reading the code
rather than from memory. Phases 1–4 of §12 are shipped; so is a generalisation
pass that was not in the original plan (multi-user, Sign in with Apple, an
admin panel, a programme catalog, cardio, deloads, Apple Health).

Ordered by ratio of value to effort. Sizes are honest: **S** is an afternoon,
**M** is a day or two, **L** is a week and a decision.

---

## Next

### 1. `generate_meal_plan` as a tool — S

The machinery is all there. `llm/fridge.ts:152` exports
`generateMealPlan(ctx, items)` and `/fridge/plan` calls it. The trainer just
cannot: it is not in `llm/tools.ts`, so "what can I cook tonight?" in chat does
nothing, and the only way to a plan is through the Fridge screen.

The work: read the latest `fridge_inventory` row for the athlete, declare the
tool, dispatch to the existing function in `llm/handlers.ts`. The §5 validator
already runs inside it.

**Files:** `server/src/llm/tools.ts`, `server/src/llm/handlers.ts`,
`server/src/services/` (a reader for the latest inventory).

### 2. The pre-session reminder — S

§8 lists five proactive triggers. Four exist (`morning_checkin`, `log_nudge`,
`dinner_prompt`, `weekly_review`). The missing one is **30 minutes before a
planned session**: today's session, and which gym in the city the athlete is
currently in.

The scheduler already sweeps per athlete against their own local clock, so this
is a handler plus a `job_schedule` row shape. The one new thing is that the
fire time depends on the planned session rather than being a fixed hour.

**Files:** `server/src/jobs/handlers.ts`, `server/src/jobs/scheduler.ts`,
a migration for the schedule row.

### 3. A TestFlight build carrying the redesign — S

The last build is **17**, which predates the redesign, the weight line chart,
the account avatar and the PPL fix. All of that is committed and the server
side is deployed; none of it is on anybody's phone.

Read [deploy.md](deploy.md) § "Adding a native capability" first if anything
native has changed since. Nothing has, so this should be a plain build.

**Also unverified:** the account avatar renders (top right, circle with an
initial) but its tap has never been exercised — the simulator's floating
dev-menu button sits exactly on it and swallows the touch. Check it on a real
device.

---

## After that

### 4. `regenerate_week` — M

The other missing §6 tool, and genuinely bigger than the first: there is no
stored week plan to regenerate. `services/week.ts` computes a week on read
(`getWeek`) rather than persisting one, so this needs a table before it needs a
tool.

Worth asking whether it should exist at all. The trainer can already swap an
exercise, change a programme and adjust targets; "rebuild the coming week" may
be a feature from the era when the week was a fixed A/B/C rotation.

### 5. Row-level security — M, and careful

Deliberately deferred, with the reasoning and the four remaining steps written
down in [tenancy.md](tenancy.md). It needs `FORCE ROW LEVEL SECURITY` and a
per-request checked-out client held across the seconds a chat request waits on
the model.

The static guard in `server/src/__tests__/tenancy.test.ts` is what stands in
for it. That guard can tell a present predicate from an absent one and nothing
more. This is the largest known gap in the app.

**Do not ship a half-version** — policies that filter when a setting is present
and pass everything through when it is absent protect only the paths that were
already careful, while making the reads look covered.

### 6. Gemini Pro access — S, but not code

`GEMINI_MODEL_SMART` points at Flash because every Pro model 404s on the
current key and `gemini-2.5-flash` is closed to new projects. The Sunday
weekly review is the most important job in the app (§8) and it wants Pro.

This is a Cloud project problem, not a code one. Nothing needs changing but
the env var, once the key can reach it.

### 7. The generalisation pass missed the model-facing strings — S

The app is multi-user; roughly forty tool descriptions, prompt lines and
comments still call the athlete "he". `llm/tools.ts` alone has fifteen — *"Omit
if he did not say"*, *"What he ate, in his words"*, *"when it came off his
mother's stove"*. `llm/coach.ts` and `llm/context.ts` have more.

This is not cosmetic. Those strings are what Gemini reads, so every athlete's
trainer is currently told, in the tool schema, that its athlete is a man.

The public-repo cleanup fixed the ones that also leaked personal data:
`set_context`, which enumerated four cities; the trainer persona's HOW YOU WORK
block; and `llm/food.ts`, whose macro estimator opened by telling the model the
athlete was 191 cm and cutting on 2300 kcal — that one was anchoring every
athlete's portion estimate to one body, so it was a real defect and not only a
leak. Better still would be passing the athlete's *own* targets into that
prompt; it has a `Ctx` and does not use it.

The rest was left rather than folded into a commit about documentation.

### 8. The rate limiter's buckets are in memory — S

Honest for one box, wrong for two. If the server is ever scaled or run
alongside a second process, per-athlete limits and the daily token budget stop
holding. Postgres is already there and would do.

---

## Bigger, and needs a decision first

### Voice mode — L

Gemini Live API, the last unstarted item in §12 phase 5. This is a project of
its own: a streaming transport, audio permissions, a native build, and a
UX question this app has not answered — what a hands-free trainer is *for*
between sets.

### Progress photos — L

The other half of measurements. Needs real object storage rather than base64
through a JSON body, which means a bucket and credentials.

### Billing — L

Whether this is free for friends, and what happens after. The admin panel
already prices every model call into `llm_usage`, so the numbers to decide with
exist. The decision does not.

---

## Deliberately not doing

Written down so nobody rediscovers them as gaps:

- **A general nutrition database.** ~90% of intake is ~25 foods. The library
  grows by use, not by seeding. Barcode scan via OpenFoodFacts covers the rest.
- **A generic program builder.** A seeded catalog plus `swap_exercise` covers
  it (§14).
- **User management, roles, onboarding funnels, analytics.** A handful of
  users. `users.is_admin` is the whole permission model.
- **Precision on vegetables.** Not required, and not requested of the athlete.

---

## Known rough edges

| | |
|---|---|
| Account avatar tap | untested — simulator overlay covers it |
| Model-facing strings | still say "he" for every athlete (item 7) |
| The rules editor sheet | placeholders are hardcoded English, not in `locale.ts` |
| Rate limiter | in-memory, single process only |
| `GEMINI_MODEL_SMART` | is Flash, not Pro |
| Last TestFlight build | 17, predates the redesign |
