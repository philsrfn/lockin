# The workout subsystem

Written for somebody about to replace it.

This is the part of lockin that decides what to lift, shows it in a gym, takes
what actually happened, and feeds it back into the next decision. It is four
pieces that only look like one, and the seams between them are where the
mistakes live.

If you are replacing the logger, read § "What is wrong with this" before you
read anything else — it is the part a map usually leaves out, and it is the
reason there is a rewrite.

---

## 1. The four pieces

```
programme          what the athlete intends to do
  program_days     the days in it, each with a CODE and a NAME
  program_slots    the movements in a day, in order, with sets/reps/increment

prescription       what to lift today, derived from history
  domain/progression.ts     pure. double progression + the §7 gates
  services/workouts.ts      assembles a WorkoutPlan from slots + history

the logger         what is happening right now, on a phone, possibly offline
  app/app/workout.tsx       the screen
  app/src/workout/useWorkout.ts   the state machine
  app/src/db/local.ts       SQLite: the source of truth mid-session
  app/src/sync/queue.ts     the drain to POST /sync

history            what was actually done
  sessions / sets  one row per session, one per set
  domain/session.ts         when a session stops counting as in progress
```

The direction of travel is one way and worth stating plainly: **slots propose,
history decides, the logger records.** A slot says "5 sets of bench, 6–12,
2.5 kg jumps". Progression reads the last time bench came up and turns that
into "5 × 8 at 70". The logger shows 70 already dialled into the stepper. What
comes back is rows in `sets`, which is what the next prescription reads. No
step in that chain asks the model anything (§1).

### The HTTP surface

All of it is in `server/src/routes/index.ts`:

| | |
|---|---|
| `GET /today` | the whole home screen, including `plan` and `openSession` |
| `GET /workouts/next?template=X` | a plan for a day other than the proposed one |
| `GET /exercises/:id/prescription` | one movement, for the swap sheet |
| `POST /sessions` · `PATCH /sessions/:id` | start · finish |
| `POST /sets` · `DELETE /sets/:id` | one set · undo one set |
| `POST /sync` | the offline queue's batch endpoint — same services, idempotent |
| `GET|POST|PUT|DELETE /programs…` | the programme editor |

`POST /sync` is not a second write path (§11): each op calls the same service
the route calls, keyed for idempotency on `(user_id, client_id)` in `sync_log`.
Keep that property or the offline queue becomes a way to log a set twice.

---

## 2. How one session actually happens

Worth reading once end to end, because half the bugs in this area are two
correct pieces disagreeing about which step they are on.

1. **The app opens.** `useWorkout` asks `/today`. On failure it reads the last
   cached payload and sets `stale` — a stale plan beats a blank screen when
   somebody is already standing at the rack.

2. **Which day?** `templateForToday` answers. An open session's day wins,
   *unless* the athlete has since switched to a programme that has no such day
   — that combination used to 404 and take the entire Today payload with it,
   home screen and trainer context included. Otherwise `upcomingTemplate` walks
   the rotation off the last logged session: A → B → C → A.

3. **Is a session already open?** Three cases, and the hook handles them in
   this order: one open locally; none locally but the server reports one
   (adopt it, and pull its sets down with `server-`-prefixed client ids);
   neither (create one locally and *queue* the create — starting a workout must
   work with no signal).

4. **The plan follows the session, never the reverse.** An already-open session
   keeps the day its logged sets belong to. Only a session started right now
   takes a day chosen on the home screen. Getting this backwards showed one
   day's exercises while writing them into another day's session.

5. **A set is logged.** SQLite first, screen second, network whenever.
   `insertSet` → `setSets` → `enqueue`. Nothing on this path can block on a
   request.

6. **The queue drains.** After every write, on foreground, and every 15s while
   anything is pending. A `create_session` comes back with the server id, which
   is written onto the local session so later ops reference it by id instead of
   by client uuid. An op the server rejects as non-retryable is marked `dead`
   and **kept** — a set that vanishes without telling anybody is worse than no
   offline support at all.

7. **Finish.** RPE, joint pain, notes. `markSessionFinished` locally, queue a
   `finish_session`, then a best-effort drain so Today is right by the time
   they look at it.

---

## 3. The invariants

These are the ones that do not announce themselves. Breaking any of them
produces something that looks like it worked.

**Day codes are history, not labels.** `sessions.template` stores `'A'`,
`'U1'`, `'Push'`. Change a code and every session logged against it is
orphaned — it still exists, it just belongs to a day that no longer exists.
So codes are derived once from the name and then frozen; the *name* stays
editable, because renaming "Pull" to "Zug" must not rewrite what happened in
March. `domain/programDraft.ts` is the whole reason that module exists.

**A session is finished when it has an RPE — or when it is old and has sets.**
`domain/session.ts`, `SESSION_LIVE_HOURS = 6`. A stale session *with* sets
counts as finished (nobody invents an RPE); *without* sets it is a false start
and is ignored. Four counting sites share `finishedSql()` / `liveSql()` from
`services/sessions.ts` so the rule lives once. If you add a fifth place that
counts sessions, use those, do not rewrite the predicate.

**The model never computes a load.** §1. Increments, rep maths, rest, the
deload factor, the joint-pain cut — all in `domain/`, all pure, all tested.
There is deliberately no tool that lets the trainer set an increment.

**`app/src/lib/plates.ts` is the one exception to "numbers live on the
server"**, because it has to answer while a stepper is moving, in a basement,
with no signal. It has its own tests: `npm --prefix app test`.

**The §7 gates sit under progression, not beside it.** Joint pain flagged on
two consecutive sessions cuts load 20% and recommends a doctor; the ramp-in
caps working sets for the first 14 days; a scheduled deload multiplies by 0.9
and rounds *down*, so a reduction is never rounded back into an increase.
`nextPrescription` checks them in that order and returns a `reason` the UI
shows. Keep the reason: "hold" and "deload" look identical on screen without
it, and one of them is the app telling somebody to back off.

**Everything is scoped by `Ctx`, and the static guard means it.**
`server/src/__tests__/tenancy.test.ts` reads every SQL literal in the source
and fails the build if a statement against an owned table does not name
`user_id`. It also forbids `current_date` / `current_timestamp` — "today"
belongs to the athlete, not the server; use `services/clock.ts`.

**Five guards fail the build rather than throwing at runtime**: tenancy,
English literals in the app (`app/src/lib/__tests__/englishLiterals.test.ts`),
pronouns in prompts, error codes, and the coach gate. If one of them fails on
a change you believe is correct, it is usually right and you are usually
missing a locale entry.

---

## 4. What is wrong with this

Honestly, since it is being replaced.

### Undo does not reach the server

`useWorkout.undoLastSet` deletes the set from local SQLite and then sends a
`DELETE /sets/:id` only when `clientId.startsWith('server-')`. That prefix is
only ever put on sets **adopted from the server** when a session is picked up
on a second device. A set logged on this phone keeps its `randomUUID()` for
life. So:

- **Set already synced** (the common case — `enqueue` drains immediately, so
  this is anything undone more than a second or two after logging): it
  disappears from the screen and stays in `sets` on the backend. It counts
  towards progression, shows up in History, and comes back in the logger after
  a restart that re-adopts the session.
- **Set still queued**: `deleteSet` removes the row from `local_sets` but not
  the op from `sync_queue`, so the next drain posts it anyway. The comment
  there says it "will fail harmlessly as a duplicate" — it will not.
  `sync_log` dedupes on a client id the server has *seen*, and it has never
  seen this one.

So undo works end to end in exactly one case: a set adopted from another
device. This is traced from the code rather than reproduced in a test — the
`server-` prefix is written in one place (adoption) and read in one place
(undo), `local_sets` has no server-id column at all, and `applyOne` in
`services/sync.ts` treats any unseen client id as new work. It is not fixed
here, because it lives in the files being rewritten and a fix now would be
thrown away — but do not carry the bug across. The shape of the fix is that a
local set needs to know its server id (the `record_set` result carries it, and
nothing currently stores it), and that removing a set must remove its queued op
too.

### The rotation is a guess dressed as a plan

`upcomingTemplate` walks A → B → C off the last logged session, which is
correct for somebody training alone on a fixed rotation and wrong for
everybody else. The plan already concedes this — `WorkoutPlan.days` carries
every day so the athlete can pick — but the *proposal* still comes from a
rotation that knows nothing about the week, the calendar, or what they trained
yesterday. This is the part that most obviously wants replacing.

### A slot is the wrong unit

`program_slots` is one exercise, one sets count, one rep range, one increment.
There is nowhere to put a superset, a drop set, an AMRAP finisher, a warm-up
that should not count towards progression, or per-set targets that differ.
Everything the app can express is "N straight sets of one movement", and
`nextPrescription` assumes exactly that shape — `workingWeight` picks the modal
weight across the session's sets and `everySetAtTop` requires them uniform. If
you widen what a slot can be, progression has to learn which sets are the
working sets, and that is the real work in this rewrite.

### Substitutions are not recorded

`swap` rewrites the plan in local state and asks for a new prescription. The
swap itself is never persisted — next session the slot is back to the original
movement, and there is no record that a substitution ever happened. For
somebody who trains in three different places with different equipment, that
is a plan that quietly forgets what they actually do.

### One plan, one round trip, no partial refresh

`/today` returns the whole home screen. Good for a cold open on bad signal,
bad for anything that changes mid-session: the plan does not update as sets
land, so the "(last: …)" line and the prescription can both be stale against
the session in progress. `excludeSessionId` exists specifically to stop the
current session poisoning its own history, which is a workaround rather than a
design.

---

## 5. If you are rewriting this

Things that have to still be true afterwards:

1. **A set survives a dead network.** Disk before screen before network. No
   spinner between the athlete and the next set.
2. **No second write path to `sets` or `sessions`.** Route and sync op and tool
   handler all call the same service (§11).
3. **Day codes on existing sessions keep meaning what they meant.** There are
   real sessions in production going back to September 2026.
4. **Migrations are additive.** The next number is `032`. Add columns and
   tables; never drop, never rewrite in place. A column that changes meaning
   gets a new name.
5. **Load stays in `domain/`, pure and tested.** If the new model needs a
   different progression rule, it is a new pure function with its own tests,
   not a prompt.
6. **Every string through `app/src/lib/locale.ts`, German and English.**
7. **Three commands green before "done"**: `npm --prefix server test`,
   `npm --prefix server run typecheck`, `npm --prefix app run typecheck`.
   Integration tests need `docker compose up -d db` first.

Tests that already cover this area, and are worth reading before changing the
thing they pin: `server/src/domain/__tests__/progression.test.ts`,
`session.test.ts`, `program.test.ts`, `programDraft.test.ts`, `deload.test.ts`,
and on the phone `app/src/lib/__tests__/plates.test.ts` and
`programmeDraft.test.ts`.
