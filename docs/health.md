# Apple Health

Logging fatigue is the main reason fitness apps are deleted in week three, and
the antidote is not a better logger — it is not having to log. Steps, sleep,
resting heart rate and a smart scale are already on the phone.

## What is read

| | Where it goes |
|---|---|
| Step count | `daily_health.steps`, the week's average against §4's 9-10k |
| Sleep analysis | `daily_health.sleep_minutes`, filed against the day he woke up |
| Resting heart rate | `daily_health.resting_hr`, and its trend against the fortnight before |
| Active energy | `daily_health.active_kcal` |
| Body mass | `bodyweight`, but **only** where he has not typed one himself |
| Workouts | `cardio_sessions`, deduped on HealthKit's uuid |

Strength workouts are deliberately skipped: those are logged in the app, and
importing them would double-count the session he just finished.

Nothing is written back yet. The entitlement is requested so that writing
sessions to Health is a change of code rather than a change of build.

## How the sync works

**A window, not a diff.** The phone sends the last fortnight on every
foreground and lets the server work out what is new. A client that remembers
what it already sent is a client that loses a week when the app is reinstalled.

That makes every write idempotent by necessity:

* Days upsert and **coalesce** — a sync that has steps but not sleep yet must
  not erase last night's sleep.
* Workouts carry HealthKit's uuid and `on conflict do nothing`, scoped per
  athlete because those uuids are unique per device, not per person.
* Weights only fill a gap or update a previous import. A number he typed always
  wins.

`POST /vitals/sync` reports what happened: days written, workouts imported
versus already had, weights imported versus kept his own.

## What the coach does with it

The context block gained a RECOVERY section it reads instead of asking:
steps per day, last night's sleep, and resting heart rate with its change
against the fortnight before. A rise of 3 bpm or more is called out explicitly,
because that is the signal that arrives before somebody feels it.

## The build requirement

HealthKit is a native module. **It does not exist in Expo Go**, and it never
will — this needs a development build or TestFlight.

Every entry point checks `Constants.appOwnership` before requiring the module,
because the absence of Nitro modules surfaces as an error that a `try/catch`
around the require does not contain. In Expo Go the settings screen says "not
available on this device" and everything else works exactly as before.

`executionEnvironment` is the modern replacement for `appOwnership` and is the
wrong tool here: it reports Expo Go and a development build identically, and a
development build *does* have the native side.

### Before the first build that includes it

1. The App ID needs the **HealthKit** capability in the Apple Developer console.
   EAS syncs capabilities during the interactive Apple login — the same dance
   push notifications needed, and the same failure if it is skipped with
   `--non-interactive`.
2. `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` come
   from the config plugin in `app.json`; they are what the permission sheet
   shows, so they are worth reading before somebody else does.
3. The iOS Simulator does support HealthKit, but starts empty. The Health app
   can add samples by hand for testing.

## What has and has not been verified

Tested: the whole server side, and the app rendering steps that arrived over
the API — 20 integration tests covering partial syncs, repeated syncs,
per-athlete dedupe, and a manual weigh-in surviving an import.

Not tested: the HealthKit reads themselves, which cannot run in Expo Go. The
query shapes are typechecked against the module's own types, and the mapping
from HealthKit's workout activity types is the part most worth checking on the
first real build.
