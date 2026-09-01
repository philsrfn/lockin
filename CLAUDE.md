# Personal Trainer App — Project Spec

Single-user iOS app: an AI personal trainer that knows Phil's body, schedule,
locations, food rules and training history, talks to him continuously, and
actually mutates his plan.

Not a product. One user. Optimise for "he uses it every day for a year", not
for scale, multi-tenancy, or generality.

---

## 1. Core principles

1. **Deterministic logic lives in code, not in the model.**
   Progressive overload, macro arithmetic, weight trend smoothing, streaks,
   rule enforcement — all plain functions with unit tests. The LLM never
   computes a number that matters.

2. **The model acts through tools, not through prose.**
   Every state change goes through a declared function call that is validated
   and written to Postgres. If the trainer says it, the DB reflects it.

3. **Hard rules are enforced by validators, not by prompts.**
   Prompts drift. A validator that rejects a breakfast without Skyr does not.

4. **Safety floors are non-negotiable and live below the model.**
   See §7.

5. **Provider-agnostic LLM layer.** All Gemini calls go through
   `server/src/llm/` behind an interface. Swapping providers later must be a
   one-directory change.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| App | Expo (React Native) + TypeScript | Phil already works in RN |
| Distribution | EAS Build → TestFlight internal (dotSpiro team) | 90-day builds, no App Review |
| Backend | Fastify + TypeScript, Docker | one language across the stack |
| DB | PostgreSQL 16 | already in Phil's stack |
| LLM | Gemini via `@google/genai` | Flash for chat, Pro for weekly review |
| Push | APNs via Expo Notifications | proactive coaching, see §8 |
| Hosting | stepfather's server, Docker Compose | |

**Never put the Gemini API key in the app.** The app talks only to the backend.
Auth is a single long-lived bearer token in the iOS keychain — one user, no
signup flow, no password reset. Do not build auth infrastructure.

### Gemini configuration

- SDK: `@google/genai`
- Chat/logging/vision: `gemini-flash` (current Flash model — check AI Studio for
  the exact current model string; do not hardcode a stale one)
- Weekly review + plan regeneration: current Pro model
- Use `systemInstruction` for the trainer persona + assembled context
- Use `responseSchema` + `responseMimeType: "application/json"` for every
  structured output (meal plans, fridge inventory, plan diffs). Do not parse
  free text.
- Use context caching for the static profile block if it exceeds ~1k tokens
- **Billing must be enabled** on the Cloud project (credits from Google AI Pro
  cover it). Free-tier traffic may be used for model training and this app
  handles body-composition data.

---

## 3. Repo layout

```
/app                  Expo app
  /screens            Chat, Today, Log, Fridge, Rules, Progress
  /components
  /api                thin client for the backend
/server
  /src
    /llm              provider interface + gemini implementation
      prompts/        system instruction templates
      tools.ts        function declarations
    /domain           progression, macros, trend — pure functions, tested
    /rules            rule schema, validator, enforcement
    /jobs             cron: nudges, weekly review
    /routes
  /migrations
/docs
```

---

## 4. Data model

```sql
-- one row, the athlete
create table profile (
  id                int primary key default 1,
  height_cm         int not null,
  birth_year        int,
  goal_weight_kg    numeric,
  calorie_target    int not null,
  protein_target_g  int not null,
  fat_floor_g       int not null,
  updated_at        timestamptz default now()
);

-- Home / Münster / Mannheim / Leipzig
create table contexts (
  id            serial primary key,
  name          text not null unique,
  equipment     jsonb not null,   -- {"gym": true, "partner": "hansefit", "notes": "..."}
  food_profile  jsonb not null,   -- {"dinner": "moms_food_half_plus_protein"}
  is_active     boolean default false
);

create table exercises (
  id           serial primary key,
  name         text not null,
  pattern      text not null,     -- squat|hinge|h_push|v_push|h_pull|v_pull|iso
  substitutes  int[] default '{}' -- for equipment-constrained swaps
);

create table sessions (
  id           serial primary key,
  performed_at timestamptz not null,
  context_id   int references contexts(id),
  template     text,              -- 'A' | 'B' | 'C'
  rpe          int,
  notes        text,
  joint_pain   boolean default false
);

create table sets (
  id           serial primary key,
  session_id   int references sessions(id) on delete cascade,
  exercise_id  int references exercises(id),
  set_index    int not null,
  weight_kg    numeric,
  reps         int,
  rir          int
);

create table bodyweight (
  measured_on  date primary key,
  weight_kg    numeric not null
);

create table meals (
  id           serial primary key,
  eaten_at     timestamptz not null,
  slot         text not null,     -- breakfast|lunch|dinner|snack
  description  text,
  kcal         int,
  protein_g    int,
  source       text               -- 'moms_food' | 'own' | 'other'
);

create table fridge_inventory (
  id           serial primary key,
  captured_at  timestamptz not null,
  context_id   int references contexts(id),
  items        jsonb not null     -- [{name, qty, confidence, confirmed}]
);

create table rules (
  id        serial primary key,
  tier      text not null check (tier in ('hard','soft','never')),
  text      text not null,
  scope     text,                 -- null = always, else context name
  active    boolean default true
);

create table chat_messages (
  id         bigserial primary key,
  role       text not null,       -- user|model|tool
  content    jsonb not null,
  created_at timestamptz default now()
);
```

---

### Seed data

```
profile: height 191cm, start 100kg, goal 80kg,
         calorie_target 2300, protein_target 190, fat_floor 70

contexts: Home | Münster | Mannheim | Leipzig
          (all gym-capable via Hansefit BEST — unlimited nationwide check-ins;
           Home additionally has food_profile = moms_food_half_plus_protein)

templates (full-body rotation, 2-3 working sets, 6-12 reps, 1-2 RIR):
  A  Squat/Leg press · Chest press · Lat pulldown · Leg curl · Cable row · Side raise
  B  Romanian deadlift · Incline DB press · Chest-supported row · Split squat · Face pull · Curl
  C  Hack squat · Overhead press · Pull-up/pulldown · Hip thrust · Cable fly · Triceps pushdown

weekly targets (not fixed weekdays — travel makes fixed days fail):
  3 × strength, 2 × zone-2 treadmill 35min, 9-10k steps/day average
  football counts as the hard cardio session
```

Ramp-in: for the first two weeks, cap at 2 working sets and 3-4 reps short of
failure. Returning from months of inactivity — connective tissue lags muscle.

---

## 5. Rules

Three tiers. Seeded from Phil's stated preferences, editable in-app.

```json
{
  "hard": [
    "Breakfast is always ~500g Skyr with berries and 40g oats. No substitutions.",
    "When context is Home, dinner is half a portion of mom's food plus a protein add-on (200g Magerquark, chicken breast, or a shake)."
  ],
  "soft": [
    "Prefer soy chunks as a protein source when cooking — cheap and already a staple.",
    "Prefer treadmill over outdoor running.",
    "Weekly movement targets, not fixed weekdays — travel makes fixed days fail."
  ],
  "never": [
    "Never propose a day under 160g protein.",
    "Never schedule hard intervals on a football day."
  ]
}
```

`validateAgainstRules(plan, rules)` runs on **every** generated meal plan and
training week. On violation: do not surface the output. Re-prompt once with the
specific violation named. On second failure, fall back to the deterministic
template and log it.

---

## 6. Tool declarations

This is the heart of the app. Declare these to Gemini; each maps to a validated
backend handler.

| Tool | Purpose |
|---|---|
| `set_context` | switch to Home / Münster / Mannheim / Leipzig |
| `log_weight` | write a bodyweight entry |
| `log_set` | record weight × reps × RIR for an exercise |
| `log_session` | close out a session with RPE, notes, joint_pain flag |
| `log_meal` | record a meal with estimated macros |
| `get_today` | today's plan, remaining macros, context |
| `get_history` | last N days of sessions / weight / meals |
| `adjust_calorie_target` | change daily kcal (validated, see §7) |
| `swap_exercise` | substitute within the same movement pattern |
| `regenerate_week` | rebuild the coming week's training |
| `add_rule` / `deactivate_rule` | mutate the rules document |
| `generate_meal_plan` | from fridge inventory + remaining macros |

Rule: any tool that writes returns the resulting state, so the model's next turn
sees ground truth rather than assuming its call succeeded.

---

## 7. Safety floors (hard-coded, below the model)

Enforced in the tool handlers. The model cannot talk its way past these.

```
MIN_CALORIE_TARGET       = 1800
MIN_PROTEIN_TARGET_G     = 160
MAX_WEEKLY_LOSS_KG       = 1.2
MIN_REST_DAYS_PER_WEEK   = 2
```

Rejected calls return an explanation the model must relay honestly. Additional
rules:

- If `joint_pain = true` on two consecutive sessions, the trainer must reduce
  load and recommend seeing a doctor. This is not optional wording — gate it in
  code.
- If 7-day average loss exceeds 1.2 kg/week for two consecutive weeks, the
  system raises the calorie target automatically and tells him why.
- Never let the model set `goal_weight_kg` below a BMI of 20 for his height.

---

## 8. Proactive coaching (cron → APNs)

Times are local, adjustable in settings.

| When | Message |
|---|---|
| 07:30 daily | Morning check-in. Confirm context for the day. Skyr reminder. |
| 30 min before planned session | Today's session + which gym in the current city |
| 90 min after session start (if no sets logged) | Nudge to log |
| 20:00 daily | Dinner logging prompt — one-tap: mom's food / own / other |
| Sunday 18:00 | Weekly review (Pro model): 7-day weight average, adherence, next week's targets and calorie adjustment |

The weekly review is the most important job in the app. It should read the last
14 days in full and produce: trend assessment, one thing that went well, one
concrete change, and the updated targets via tool calls.

---

## 9. Fridge photo flow

1. Camera → image sent to backend (never straight to Google from the app)
2. Gemini Flash vision → `responseSchema` yielding
   `[{name, estimated_qty, confidence}]`
3. **User confirms/edits the list.** Never generate a plan off an unconfirmed
   vision pass — mis-detected ingredients produce plans he can't actually cook.
4. Confirmed list → `fridge_inventory`
5. `generate_meal_plan` runs against inventory + **remaining** macros for today
   (not the daily total) + active rules for the current context
6. Validator pass (§5) → present

---

## 10. Trainer system instruction

Assembled fresh per request. Keep under ~3k tokens.

```
You are Phil's personal trainer. You have worked with him for months.

PERSONA
Direct and warm. You know his history, so you don't re-explain basics.
You ask about how he actually feels before prescribing. You never
moralise about food. You push when he's coasting and back off when he's
beaten up. Short messages — he reads on his phone.

ATHLETE
{height, current weight, 7-day trend, goal, targets}

CURRENT CONTEXT
{active context, equipment available, food profile}

RULES
{hard / soft / never, filtered to current context}

RECENT
{last 14 days: sessions with top sets, weight trend, meal adherence}

TODAY
{planned session, macros consumed so far, macros remaining}

You have tools. Use them. When Phil tells you something that changes his
plan, call the tool — do not merely agree in text.
```

---

## 11. Screens and interaction model

**Chat is not the primary interface.** Structured UI handles the 95% that
repeats — sets, meals, weight. Chat handles the 5% that is novel. Typing
"squats 3x8 at 90" is slower than three taps and occasionally parses wrong.

**Both paths hit the same handlers.** `POST /sets` is called by the Log screen
*and* by the `log_set` tool. Never two code paths to the same table.

### Today (default tab)

Context chip (tap to switch city) · today's session or REST · macros remaining
with protein emphasised · 7-day weight trend sparkline. Two primary buttons:
**Start workout**, **Log food**.

### Workout logger — the screen that must be excellent

This is used one-handed, sweaty, between sets, on bad wifi. Optimise ruthlessly.

- Opens pre-populated from the template with last session's numbers as the
  target: `Squat — 3×8 @ 90kg (last: 3×8 @ 87.5)`
- Set row = weight stepper (±2.5kg), rep stepper (±1), large confirm button.
  Hitting the target should be **one tap**, not four.
- Rest timer auto-starts on set confirm. Per-exercise default duration.
- RIR as an optional chip row: `easy / 2 / 1 / failure`
- Swap button → substitutes filtered by movement pattern (`exercises.substitutes`)
- **Offline-first.** Writes go to local SQLite immediately, then a sync queue
  drains to the backend. Never block a set on the network.
- Finish session → RPE slider, joint-pain toggle, optional note.

### Food logger

Do **not** build or integrate a general nutrition database. ~90% of intake is
~25 foods.

- Top: quick-add tiles for actual staples, saved as composites with fixed
  macros — `Skyr breakfast`, `Mom's dinner (half) + Quark`, `Soy chunk bowl`.
  One tap logs the whole thing.
- Then: recent entries, then search within his own library.
- Then: manual entry (kcal / protein / fat / carbs) which offers "save to my
  foods" — the library grows by use, not by seeding.
- Running totals pinned at top. **Protein remaining is the hero number.**
- Precision on vegetables is not required and should not be requested.
- Optional later: barcode scan via OpenFoodFacts (free, decent German coverage).

### Weight

One number pad. Three seconds. Shows the entry plus the 7-day average, and
makes clear the average is the number that counts.

### Rules / Profile

Editor over §5. Three tiered lists, add/edit/deactivate, scope selector for
per-context rules.

### Chat

Free-text plus the tool set. Reachable from everywhere, default to nothing.

---

## 12. Build order

Ship each phase to TestFlight before starting the next. Using it beats
building it.

**Phase 1 — skeleton (works without any AI)**
Backend + Postgres + single-user token auth. Contexts. A/B/C training
templates seeded. Log sets, log bodyweight. Deterministic double progression.
Today screen. → *Already useful.*

**Phase 2 — the trainer**
Gemini chat with context assembly + the tool set. Chat tab. This is where it
starts to feel like the thing.

**Phase 3 — proactive**
Cron jobs + APNs push. The morning check-in and the Sunday review.

**Phase 4 — food**
Meal logging with macro totals. Rules editor. Fridge photo → inventory →
meal plan.

**Phase 5 — polish**
HealthKit step import. Progress charts. Gemini Live API voice mode.

---

## 13. Environment

```
GEMINI_API_KEY=          # from AI Studio, Cloud billing enabled
GEMINI_MODEL_FAST=
GEMINI_MODEL_SMART=
DATABASE_URL=
APP_BEARER_TOKEN=
APNS_KEY_ID=
APNS_TEAM_ID=            # dotSpiro team ID
TZ=Europe/Berlin
```

---

## 14. Notes for Claude Code

- Write `server/src/domain/` first, with tests, before any LLM code. Progression
  and macro math are the parts that must never be wrong.
- The rules validator gets tests too, including the Skyr case explicitly.
- Do not add user management, roles, onboarding flows, or analytics. One user.
- Do not abstract the training program into a generic program builder. Three
  hardcoded templates plus `swap_exercise` covers it.
- Prefer boring, readable code over clever. This is a codebase Phil will return
  to after three-week gaps.
