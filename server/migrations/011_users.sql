-- Multi-tenancy: every row gains an owner.
--
-- Done now, while production holds one man's training history rather than his
-- and his friends'. The plan's ordering rule is that the frightening,
-- irreversible things happen while there is still only one user to re-check.
--
-- Strictly additive to the data: nothing is dropped, nothing is rewritten, and
-- every existing row is backfilled to user 1 before its column is made NOT
-- NULL. The only column removed is profile.id, a surrogate key nothing
-- references, whose `check (id = 1)` was one of the three constraints that made
-- a second user impossible.

create table users (
  id          serial primary key,
  name        text,
  email       text unique,
  -- sha256 of the bearer token, hex. The token itself is never stored, and
  -- authentication becomes a lookup rather than a comparison against one env
  -- var — which is what makes handing a friend a token possible at all.
  token_hash  text unique,
  created_at  timestamptz not null default now()
);

-- The athlete this database was built for. Keeping id 1 means every backfill
-- below is a constant, and his phone's token keeps working.
insert into users (id, name) values (1, 'Phil');
select setval(pg_get_serial_sequence('users', 'id'), 1, true);

-- Owned tables. exercises is deliberately absent: it is a catalog of movements,
-- not anyone's data, and copying 35 rows per user would be duplication for its
-- own sake. Per-user exercises are a Phase 2 concern.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profile', 'contexts', 'sessions', 'sets', 'bodyweight', 'meals',
    'fridge_inventory', 'rules', 'chat_messages', 'sync_log', 'foods',
    'coach_notes', 'job_schedule', 'job_runs', 'push_tokens', 'weekly_reviews'
  ] loop
    execute format(
      'alter table %I add column user_id int references users(id) on delete cascade', t);
    execute format('update %I set user_id = 1', t);
    execute format('alter table %I alter column user_id set not null', t);
  end loop;
end $$;

-- --- the three structural blockers ------------------------------------------

-- 1. profile was pinned to a single row by a check constraint.
alter table profile drop constraint profile_is_singleton;
alter table profile drop column id;
alter table profile add primary key (user_id);

-- 2. bodyweight was keyed on the date alone, so two people could not both weigh
--    in on the same morning.
alter table bodyweight drop constraint bodyweight_pkey;
alter table bodyweight add primary key (user_id, measured_on);

-- 3. a food name was unique across the whole system.
drop index foods_name_key;
create unique index foods_name_key on foods (user_id, lower(name)) where not archived;
drop index foods_barcode_key;
create unique index foods_barcode_key on foods (user_id, barcode) where barcode is not null;

-- --- state that was global because there was only one of him ----------------

alter table contexts drop constraint contexts_name_key;
create unique index contexts_name_key on contexts (user_id, name);

drop index rules_code_key;
create unique index rules_code_key on rules (user_id, code) where code is not null;

-- An idempotency ledger keyed on a client uuid alone would let one phone's
-- replay return another person's stored result.
alter table sync_log drop constraint sync_log_pkey;
alter table sync_log add primary key (user_id, client_id);

alter table coach_notes drop constraint coach_notes_pkey;
alter table coach_notes add primary key (user_id, for_date);

alter table weekly_reviews drop constraint weekly_reviews_pkey;
alter table weekly_reviews add primary key (user_id, week_ending);

-- Schedules are per person: 07:30 means his 07:30, and someone who lifts at
-- night wants a different hour entirely.
alter table job_schedule drop constraint job_schedule_pkey;
alter table job_schedule add primary key (user_id, job);

-- The (job, ran_for) key is what stops a redeploy double-sending a push. With
-- two users it would also stop the second person's check-in from ever firing.
alter table job_runs drop constraint job_runs_pkey;
alter table job_runs add primary key (user_id, job, ran_for);

-- push_tokens keeps `token` as its key — a token identifies one install of the
-- app — but a push must now be addressed rather than broadcast.

-- --- indexes for the reads the app actually makes ---------------------------

create index sessions_user_performed_idx on sessions (user_id, performed_at desc);
create index meals_user_eaten_idx        on meals (user_id, eaten_at desc);
create index sets_user_exercise_idx      on sets (user_id, exercise_id);
create index foods_user_recent_idx       on foods (user_id, last_used_at desc nulls last);
create index chat_messages_user_idx      on chat_messages (user_id, id desc);
create index push_tokens_user_idx        on push_tokens (user_id);
