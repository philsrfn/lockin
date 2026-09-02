# Generalisation: where it stands

The plan this follows is [The Generalisation Plan][plan]. This is the register
of what is done, what is deliberately not, and what needs a decision only Phil
can make.

[plan]: https://claude.ai/code/artifact/6f13c1a0-2fee-487f-9ca6-bca41b1ca0e1

## Done

**Phase 0 — foundations.** Integration tests against a real Postgres for every
service, including the offline sync queue. Per-athlete timezone, replacing
"today in Berlin" at fourteen call sites. Request ids, one structured log
stream, and LLM token usage that is no longer computed and thrown away.

**Phase 1 — multi-tenancy.** A users table and `user_id` on sixteen tables. The
three structural blockers are gone: `profile`'s singleton check, `bodyweight`
keyed on the date alone, a food name unique across the whole system. Every
service takes a `Ctx`. Push is addressed rather than broadcast. The scheduler is
a per-athlete sweep against each one's local clock. Authentication resolves a
token against `users.token_hash`. See [tenancy.md](tenancy.md).

**Phase 2 — content ownership.** Onboarding computes targets from the body in
front of it. Programmes are three seeded rows rather than one hardcoded object.
Places are the athlete's to define. The interface and the trainer speak the
athlete's language. Substitutes are filtered by what the place actually has.

**Phase 3 — the gaps in "all-in".** Cardio you can log, counted in the weekly
targets. Planned deloads on top of the reactive one. Waist and the rest of the
tape.

**Phase 4 — safety.** Floors derived from the body rather than from one man's.
Onboarding refuses a deficit to somebody already underweight or still growing,
says why, and points at somebody qualified. The same rule sits under the
trainer's `adjust_calorie_target` tool. The trainer's own instructions gained
the boundaries the persona implied but never stated.

**Phase 5 — part.** Per-athlete rate limits and a daily token budget checked
before each model call.

## Deliberately not done

**Row-level security.** Reasoned through in [tenancy.md](tenancy.md). It needs
`FORCE ROW LEVEL SECURITY` and a per-request checked-out client held across the
seconds a chat request waits on the model. A half-version — policies that filter
when a setting is present and pass everything through when it is absent —
protects only the paths that were already careful while looking like the reads
are covered. A static guard reads every SQL literal in the source instead, and
the four steps that would finish the real thing are written down.

**Progress photos.** The other half of measurements. They need real object
storage, not base64 through a JSON body, which means a bucket and credentials.

## Needs a decision, not an afternoon

| | What it needs |
|---|---|
| **Sign in with Apple** | An Apple Developer key and capability, and the App Store requires it wherever another social login exists. The token scheme underneath it does not change — it already resolves to a row. |
| **Apple Health** | A native module, entitlements, and a physical device to test on. Passive data is the antidote to logging fatigue, which is the main reason fitness apps get deleted in week three. |
| **Object storage** | For photos, and later for anything else with a file in it. |
| **Billing** | Whether this is free for friends, and what happens after. |
| **A second process** | The rate limiter's buckets are in memory. That is honest for one box and wrong for two. |

## Running it

`npm run user:create -- --name Sam` on the box provisions an athlete and prints
their token once. They install the same TestFlight build and enter it. They get
their own profile, timezone, language, place, programme, rules and schedule —
and none of Phil's.
