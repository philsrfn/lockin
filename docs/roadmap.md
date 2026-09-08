# What is left

Audited against [CLAUDE.md](../CLAUDE.md) on 2026-09-04, by reading the code
rather than from memory. Phases 1–4 of §12 are shipped; so is a generalisation
pass that was not in the original plan (multi-user, Sign in with Apple, an
admin panel, a programme catalog, cardio, deloads, Apple Health).

Ordered by ratio of value to effort. Sizes are honest: **S** is an afternoon,
**M** is a day or two, **L** is a week and a decision.

---

## Done since this list was written

**The scan bug, and the language (2026-09-08).** Scanning a product a second
time logged 100 g of it silently, with the weight field hidden. The cause was
that `foods` rows had no unit basis: barcode rows held per-100 g figures and
looked exactly like portions, so both readers guessed and both guessed 100.
Migration 027 records the basis; `domain/portions.ts` refuses rather than
assumes. Production had **14 foods** affected, across both athletes.

Found alongside it: **71 user-facing strings were hardcoded English**, 22 of
them in onboarding. All now go through `locale.ts`. And the grams field
appended without limit — 1050250 g offering 651155 kcal with the button still
enabled.

**Shipped as TestFlight build 19**, together with the three branches that had
been sitting unmerged: the History screen, measured expenditure, and the bar
loading with personal bests.

**`generate_meal_plan` (2026-09-04).** The trainer can plan the rest of today
from the fridge. Doing it turned up the reason it had never been done:
`fridge_inventory` was in the schema and in the tenancy guard but **nothing
ever wrote to it** — §9 step 4 was never built, and the Fridge screen posted
its list straight to the planner from component state. So confirmation is
durable now (`services/fridge.ts`), and the tool reads it.

Two decisions worth knowing about. The tool takes **no parameters**, so the
model cannot hand it a fridge — that is §9's whole point, expressed in the
schema rather than in prompt wording. And a list goes stale after four days
(`domain/fridge.ts`), because a list that was right on Tuesday describes food
that was eaten on Wednesday.

**The pre-session reminder (2026-09-04).** §8's fifth trigger, now
`session_reminder` at 17:00 local. §8 asks for it "30 min before planned
session", which the model cannot answer — nothing records when today's session
is meant to start, because §5 makes the targets weekly on purpose. So it fires
at a time of day and stays quiet unless today is a lifting day that has not
happened yet. It costs no model call: it reads the note the morning check-in
already wrote, and falls back to the week's own arithmetic when there is none.

**A live bug, found on the way (2026-09-04).** `coach_notes.template` was still
checked against `('A','B','C')` from migration 004. The catalogue has offered
Push/Pull/Legs and Upper/Lower since migration 015, so for anybody not on full
body, writing the day's note threw a constraint violation — a 500 on the Today
screen's coach card, and a morning check-in silently falling back to its
generic headline every day. Migration 026 drops the constraint; the day codes
are validated against the athlete's actual programme, which is where they
belong. **Deployed 2026-09-04**; verified against production, where both
athletes are on Push / Pull / Legs and the last stored note was from the day
before the switch.

---

## Next

### 1. Server error messages are English — S

The app shows `caught.message` from the server straight to the athlete, and
every `badRequest`/`notFound` string is English. Most are edge cases, but the
barcode ones are not: *"No product with that barcode"* and *"That product has
no usable nutrition data. Enter it by hand."* are exactly what somebody new
hits while scanning things to see what happens, and they arrive in English on
an otherwise German screen.

The profile already carries a locale, so the server could answer in it. The
cheaper route is codes on `HttpError` and a lookup in `locale.ts`, which keeps
the words where the other words are.

### 2. `regenerate_week` — M

The other missing §6 tool, and genuinely bigger than the first: there is no
stored week plan to regenerate. `services/week.ts` computes a week on read
(`getWeek`) rather than persisting one, so this needs a table before it needs a
tool.

Worth asking whether it should exist at all. The trainer can already swap an
exercise, change a programme and adjust targets; "rebuild the coming week" may
be a feature from the era when the week was a fixed A/B/C rotation.

### 3. Row-level security — M, and careful

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

### 4. Gemini Pro access — S, but not code

`GEMINI_MODEL_SMART` points at Flash because every Pro model 404s on the
current key and `gemini-2.5-flash` is closed to new projects. The Sunday
weekly review is the most important job in the app (§8) and it wants Pro.

This is a Cloud project problem, not a code one. Nothing needs changing but
the env var, once the key can reach it.

### 5. The generalisation pass missed the model-facing strings — S

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

`llm/fridge.ts` went the same way when the meal-plan tool was built — its
vision and planning instructions both spoke about one man.

The rest was left rather than folded into a commit about something else.

### 6. The rate limiter's buckets are in memory — S

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
| Model-facing strings | still say "he" for every athlete (item 5) |
| The rules editor sheet | placeholders are hardcoded English, not in `locale.ts` |
| Rate limiter | in-memory, single process only |
| `GEMINI_MODEL_SMART` | is Flash, not Pro |
| App test runner | covers `src/lib/` only — no React, no renderer |
| The server has 961 MB | a docker build starves sshd; see deploy.md |
