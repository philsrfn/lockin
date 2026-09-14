-- What one session was, written down while it still matters.
--
-- The weekly review (007) answers "how is the block going". This answers the
-- question asked ten minutes after racking the last set, in the car park,
-- which is a different and much smaller question: was that any good, and
-- better than last time?
--
-- ONE ROW PER SESSION, NOT PER ATTEMPT
--
-- The unique constraint on the session is the whole idempotency story. A
-- finish arrives through the offline queue, which retries; it may also arrive
-- through PATCH /sessions/:id. Both land here, and the second one must not
-- cost a second model call or a second push. `on conflict do nothing` plus
-- this constraint is the entire mechanism — no advisory lock, no job table,
-- nothing that can be half-held when the process dies.
--
-- THE NUMBERS ARE STORED, NOT RECOMPUTED
--
-- `facts` is the output of `domain/sessionReport.ts`, computed once from the
-- sets as they stood at the close. Recomputing it on read would quietly
-- rewrite history: a set deleted next week would change what the report said
-- last Tuesday, and a report that changes after you read it is not a report.
-- It also means the screen renders with no model call and works offline once
-- the payload is cached.
--
-- The prose is stored beside it rather than in it, because the prose is the
-- part that may be regenerated if the persona changes and the numbers are the
-- part that may not.

create table session_reports (
  id         serial primary key,
  user_id    int not null references users(id) on delete cascade,
  session_id int not null references sessions(id) on delete cascade,
  -- `domain/sessionReport.ts`'s SessionFacts, verbatim.
  facts      jsonb not null,
  -- One line, read on a lock screen. The rest is read if the line earns it.
  headline   text not null,
  assessment text not null,
  -- The single change for next time. Null when the session gave no honest
  -- basis for one — a first session has nothing to compare against, and
  -- inventing advice to fill a field is how a trainer stops being believed.
  one_thing  text,
  created_at timestamptz not null default now(),
  unique (user_id, session_id)
);

create index session_reports_recent_idx on session_reports (user_id, created_at desc);

select apply_tenant_policy('session_reports');
