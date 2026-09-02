-- What the trainer costs, per athlete per day.
--
-- Token usage was computed on every call and thrown away. With one user and a
-- €10 cap on the Google account that was survivable; with a handful of friends
-- it is the one line item that scales with use and has no ceiling, and the
-- failure mode is a bill rather than an error.
create table llm_usage (
  user_id        int not null references users(id) on delete cascade,
  -- The athlete's day, not the server's.
  day            date not null,
  purpose        text not null,
  calls          int not null default 0,
  prompt_tokens  bigint not null default 0,
  output_tokens  bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, day, purpose)
);

-- A day's worth of tokens. Generous for somebody using the app as intended and
-- a hard stop for anything that is not — a loop, a stuck retry, or somebody
-- pasting a novel into the chat.
alter table profile add column daily_token_budget int not null default 300000
  check (daily_token_budget >= 0);
