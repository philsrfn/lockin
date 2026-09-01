-- The trainer's read on a given day: whether it is a lifting day, a treadmill
-- day or a rest day, and why.
--
-- Cached per date because it costs a model call and because the answer should
-- not drift every time he opens the app. Regenerated on demand when something
-- material changes — he switches city, or finishes a session.

create table coach_notes (
  for_date      date primary key,
  session_type  text not null check (session_type in ('strength','cardio','rest')),
  template      text check (template in ('A','B','C')),
  headline      text not null,
  body          text not null,
  swaps         jsonb not null default '[]',
  context_name  text,
  created_at    timestamptz not null default now()
);
