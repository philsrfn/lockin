-- Phase 3: proactive coaching. Additive — new tables only.

-- When each job should fire (§8). A table rather than columns on profile so the
-- times are adjustable and a new job does not need a migration.
create table job_schedule (
  job          text primary key,
  hour         int not null check (hour between 0 and 23),
  minute       int not null check (minute between 0 and 59),
  -- null = every day. 0 = Sunday, matching Postgres' extract(dow).
  day_of_week  int check (day_of_week between 0 and 6),
  enabled      boolean not null default true
);

insert into job_schedule (job, hour, minute, day_of_week) values
  ('morning_checkin', 7,  30, null),
  ('dinner_prompt',   20, 0,  null),
  ('weekly_review',   18, 0,  0);

-- One row per job per logical day it covers. The scheduler checks this before
-- running, so a restart, a redeploy, or two ticks landing in the same minute
-- cannot double-fire a push notification.
create table job_runs (
  job         text not null,
  ran_for     date not null,
  ran_at      timestamptz not null default now(),
  status      text not null,
  detail      jsonb,
  primary key (job, ran_for)
);

create index job_runs_ran_at_idx on job_runs (ran_at desc);

-- Expo push tokens. One user, but he may install on more than one device, and
-- reinstalling issues a new token.
create table push_tokens (
  token         text primary key,
  platform      text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- The Sunday review, kept so he can read last week's again.
create table weekly_reviews (
  week_ending    date primary key,
  trend          text not null,
  went_well      text not null,
  one_change     text not null,
  targets_note   text,
  model          text not null,
  created_at     timestamptz not null default now()
);
