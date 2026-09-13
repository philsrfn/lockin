-- The backstop under every `where user_id`.
--
-- Until now the protection against reading somebody else's data was that every
-- query says whose data it wants, and a static guard that fails the build when
-- one does not. docs/tenancy.md called that out as the largest known gap in the
-- app, and it was an honest gap while a dozen people who know each other were
-- using it. It stops being honest the moment strangers' training and weight
-- data is in here.
--
-- The guard can tell a present predicate from an absent one. It cannot tell a
-- correct one from a wrong one — `where user_id = $2` with the arguments the
-- wrong way round passes it. This catches that, because the database itself
-- refuses to return the row.
--
-- HOW THE TENANT ARRIVES
--
-- `app.user_id` is set inside the transaction that runs the query, by
-- `scopedTo()` in src/db.ts. Transaction-local on purpose: it cannot outlive
-- the statement it was set for, so a pooled connection never carries one
-- request's tenant into the next.
--
-- FAIL CLOSED
--
-- Unset means `current_setting(..., true)` is null, every comparison is null,
-- and nothing is returned. A code path that forgets the tenant reads zero rows
-- rather than everybody's — loudly wrong instead of quietly wrong. The
-- alternative, policies that pass everything through when the setting is
-- absent, was considered and rejected in docs/tenancy.md: it protects only the
-- paths that were already careful while making the reads look covered.
--
-- WHY THERE IS A SECOND ROLE
--
-- Two things exempt a connection from row level security, and this database
-- had both. The owner of a table is exempt unless the table is marked FORCE,
-- and a superuser is exempt always — FORCE does not reach them. The app
-- connects as `lockin`, which owns every table and is the cluster's bootstrap
-- superuser, so policies alone were decoration. The test in
-- src/__tests__/rls.int.test.ts is what caught that: it asked for another
-- athlete's rows and got them.
--
-- The bootstrap role cannot give up superuser — Postgres refuses, and it is
-- right to. So instead there is `lockin_app`, which owns nothing and is
-- nobody's superuser, and every scoped transaction switches into it with
-- `set local role` before it touches a table. Inside that transaction the
-- policies below are the law; on commit the role reverts with everything else
-- that was set locally.
--
-- WHAT THIS DOES NOT DO
--
-- A query that never goes through a `Ctx` still runs as the owner and still
-- sees everything. Those are countable and named — the migration runner,
-- provisioning an athlete, the admin panel — and `crossTenant()` in db.ts is
-- how they say so out loud. Making even a forgotten query fail closed means
-- the app connecting as `lockin_app` in the first place, which is a change to
-- a credential rather than to a schema; docs/tenancy.md carries the step.
--

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lockin_app') then
    create role lockin_app nosuperuser nologin;
  end if;
end $$;

-- Membership, so the connecting role may `set role` into it. Attributes are
-- never inherited through membership, which is the point: holding this grant
-- changes nothing about a normal session.
do $$
begin
  execute format('grant lockin_app to %I', current_user);
end $$;

grant usage on schema public to lockin_app;
grant select, insert, update, delete on all tables in schema public to lockin_app;
grant usage, select on all sequences in schema public to lockin_app;

-- And for every table a later migration adds, without anybody remembering.
alter default privileges in schema public
  grant select, insert, update, delete on tables to lockin_app;
alter default privileges in schema public
  grant usage, select on sequences to lockin_app;

-- The policy itself, as a function, so a later migration adding a table is one
-- line rather than a copy of this paragraph. Copies drift; this one would drift
-- into a table that looks protected and is not.
create or replace function apply_tenant_policy(target text, shared boolean default false)
returns void language plpgsql as $fn$
declare
  -- A boolean cannot be interpolated into SQL text as a condition; it renders
  -- as `t` or `f`, which is a column name. The clause is built instead.
  shared_rows text := case when shared then 'or user_id is null' else '' end;
begin
  execute format('alter table %I enable row level security', target);
  execute format('alter table %I force row level security', target);
  execute format('drop policy if exists tenant_isolation on %I', target);
  execute format($p$
    create policy tenant_isolation on %I
      using (
        current_setting('app.cross_tenant', true) = 'on'
        %s
        or user_id = nullif(current_setting('app.user_id', true), '')::int
      )
      with check (
        current_setting('app.cross_tenant', true) = 'on'
        or user_id = nullif(current_setting('app.user_id', true), '')::int
      )
  $p$, target, shared_rows);
end $fn$;

do $$
declare
  owned text;
begin
  -- Derived from the schema rather than listed by hand. A table added in a
  -- later migration gets the same treatment by carrying a user_id, which is
  -- the same reasoning the test helpers use to decide what to truncate — and
  -- the reason this list is longer than the static guard's was: measurements,
  -- cardio_sessions, daily_health, deloads, llm_usage, sessions_tokens and
  -- programs all hold somebody's data and none of them were on it.
  for owned in
    select table_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'user_id'
      and table_name not like 'pg_%'
    order by table_name
  loop
    -- `programs` is the only one where a null user_id means "everybody's":
    -- the built-in catalogue is shared, and reading has always included it.
    perform apply_tenant_policy(owned, owned = 'programs');
  end loop;
end $$;

-- program_days and program_slots carry no user_id of their own; they hang off
-- a programme and are only reachable through one. Their protection is that
-- every statement touching them joins `programs`, which is covered above —
-- see services/programs.ts, where the ownership check is in the insert itself.
