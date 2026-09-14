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

## Row-level security

In place since migration 028. A policy on every table that carries a `user_id`,
reading `app.user_id`, which `scopedTo()` in `src/db.ts` sets inside the
transaction that runs the query.

**Transaction-local, not session-level.** An earlier sketch of this held a
client for the life of the request and set the tenant on it. That works and it
has a failure mode worth avoiding: the client must be released on every exit
path — responses, thrown errors, timeouts, aborted sockets — and a chat
request holds one for the ten seconds it waits on a model. One missed release
is a connection gone from the pool for good, and the symptom arrives much
later as an app that hangs. Hanging it off the transaction instead means the
setting cannot outlive the statement it was set for, so a pooled connection
never carries one request's tenant into the next. That is structural rather
than something to remember.

**Why there is a second role.** Two things exempt a connection from row level
security, and this database had both: the owner of a table is exempt unless
the table is marked `FORCE`, and a superuser is exempt always — `FORCE` does
not reach them. The app connects as `lockin`, which owns every table and is
the cluster's bootstrap superuser. Policies alone were decoration, and the
test caught it: `rls.int.test.ts` asked for another athlete's rows and got
them.

The bootstrap role cannot give up superuser; Postgres refuses. So there is
`lockin_app`, which owns nothing and is nobody's superuser, and every scoped
transaction does `set local role lockin_app` before it touches a table. Inside
that transaction the policies are the law, and the commit puts the role back
with everything else that was set locally.

**The four ways past it.** A grep for `crossTenant` finds all of them:

| | |
|---|---|
| the migration runner | DDL and seeds, before anybody exists |
| provisioning an athlete | rows written before there is a tenant for them to belong to |
| the admin panel | reading across everybody is its whole job; every route that reaches it is behind `requireAdmin` |
| registering a push token | a device that changes hands takes its token with it |

The first three were known. The fourth was found by switching the policies on
and watching Postgres refuse — which is the best argument for having done it.

**What is still open.** A query that never goes through a `Ctx` runs as the
owner and still sees everything, so this is not yet fail-closed: forgetting to
scope reads everything rather than nothing. Every service path goes through a
`Ctx` — the static guard above is what keeps that true — but the property is
weaker than it could be.

Closing it means the app connecting as `lockin_app` rather than as the owner.
That is a credential change rather than a schema one:

1. Give `lockin_app` `login` and a password, in `deploy/.env` rather than in a
   migration.
2. Point `DATABASE_URL` at it — locally, in CI, and on the box.
3. Keep a second URL as the owner for the migration runner, which needs DDL
   rights `lockin_app` does not have.
4. Tighten the test in `rls.int.test.ts` that currently asserts the frontier.
   It is written so that it *fails* once this is done, rather than leaving a
   comment nobody reads.

## Authentication

One long-lived token per athlete, matched by its sha256 against
`users.token_hash`. The token is never stored, so a database dump is not a list
of passwords. `npm run user:create -- --name Sam` provisions an athlete and
prints their token once.

Phil's token is still configured as `APP_BEARER_TOKEN` and mirrored onto user 1
at boot, so the build already on his phone keeps working. Sign in with Apple
replaces the front of this; the row it resolves to does not change.
