# Tenancy

Every table that holds a person's data carries a `user_id`, and every service
takes a `Ctx` — who is asking, on which connection. There is no call site that
reads a table without saying who, because `Ctx` replaced the optional `db`
argument rather than joining it: a query with no tenant does not compile.

## What is protected, and how

| Layer | Mechanism |
|---|---|
| Types | `Ctx` is a required first argument on every service function. |
| SQL | Every statement filters on `user_id`. Selects that exist as fragments (`sessions`, `contexts`, `foods`) carry the predicate themselves, so an unscoped fragment does not exist to be reused. |
| Ids from outside | A cross-tenant id reads as **missing**, not as forbidden — the caller cannot learn whether it exists, and it is not theirs either way. |
| Authoring | `src/__tests__/tenancy.test.ts` reads every SQL literal in the source and fails on one that touches an owned table without naming `user_id`. |
| Behaviour | `src/services/__tests__/isolation.int.test.ts` checks every read from both sides with two real athletes. |

`exercises` is deliberately unowned: it is a catalog of movements, not anyone's
data. Per-user exercises are a Phase 2 concern.

## Row-level security is NOT in place

The plan calls for RLS as a backstop, on the reasoning that a forgotten `where
user_id` should return nothing rather than someone else's rows. It is not here
yet, and the reason is worth writing down rather than discovering later.

The app connects to Postgres as the owner of its tables, and an owner is exempt
from RLS unless the table is marked `FORCE ROW LEVEL SECURITY`. So a real
backstop needs `FORCE`, and `FORCE` needs the current tenant to be readable
from inside the database — a `current_setting('app.user_id')` set per
connection.

That is where it becomes a change to the request lifecycle rather than a
migration. Connections come from a pool, so a session-level setting cannot be
trusted: a query issued on a pooled connection may land on one still carrying
the previous request's tenant. Setting it correctly means each request holds a
checked-out client for its whole life — including the ten seconds a chat
request spends waiting on the model — and releasing it reliably on every exit
path, aborts and timeouts included. A leaked client is pool exhaustion; a
missed setting is a query that silently returns nothing.

A half-measure was considered and rejected: policies that filter when the
setting is present and pass everything through when it is absent. That is
deployable and cannot break anything, but it protects only the paths that were
already careful, while looking from the outside like the reads are covered. A
protection that cannot be trusted is worse than a documented gap.

**What is needed to finish it**

1. A dedicated non-owner database role for the app, or `FORCE ROW LEVEL
   SECURITY` on every owned table.
2. A per-request checked-out client, set with the tenant on acquire and
   released on `onResponse`, `onError` and `onTimeout` alike.
3. A `set_config(..., true)` inside `transactionFor`, so writes carry the
   tenant into their transaction.
4. A test that a service called with a mismatched `Ctx` returns nothing rather
   than the wrong rows — the test that proves the backstop is live.

Until then the static guard above is the substitute. It cannot tell a correct
predicate from a wrong one, only a present one from an absent one. That is
still the difference between catching the mistake while writing it and catching
it when somebody sees another person's body weight.

## Authentication

One long-lived token per athlete, matched by its sha256 against
`users.token_hash`. The token is never stored, so a database dump is not a list
of passwords. `npm run user:create -- --name Sam` provisions an athlete and
prints their token once.

Phil's token is still configured as `APP_BEARER_TOKEN` and mirrored onto user 1
at boot, so the build already on his phone keeps working. Sign in with Apple
replaces the front of this; the row it resolves to does not change.
