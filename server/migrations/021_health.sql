-- Passive data from Apple Health.
--
-- Logging fatigue is the main reason fitness apps get deleted in week three,
-- and the antidote is the data somebody's phone already has. It also gives the
-- coach the recovery signals it currently has to ask about: whether he slept,
-- and whether his resting heart rate says the last block is catching up.
--
-- One row per day per athlete, because that is how every one of these is read.
-- A sync is a partial picture — the phone may have steps but not sleep — so the
-- upsert coalesces rather than overwrites.
create table daily_health (
  user_id       int not null references users(id) on delete cascade,
  -- The athlete's day, decided on the phone where the samples were taken.
  day           date not null,
  steps         int check (steps between 0 and 200000),
  sleep_minutes int check (sleep_minutes between 0 and 1440),
  resting_hr    int check (resting_hr between 25 and 200),
  active_kcal   int check (active_kcal between 0 and 20000),
  updated_at    timestamptz not null default now(),
  primary key (user_id, day)
);

-- Where a row came from, so an import can never quietly overwrite something he
-- typed. 'manual' is everything that already exists.
alter table cardio_sessions add column source text not null default 'manual';
alter table cardio_sessions add column external_id text;

-- The dedupe key for imports: HealthKit hands out a stable uuid per workout,
-- and a sync that runs twice must not double-count a run.
create unique index cardio_external_key on cardio_sessions (user_id, external_id)
  where external_id is not null;

alter table bodyweight add column source text not null default 'manual';
