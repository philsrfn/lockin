-- Cardio you can log.
--
-- The trainer has been prescribing 35 minutes of zone-2 twice a week with no
-- way to know whether it happened, and the week strip counts three lifts and
-- silently drops the other two sessions because there was nowhere to put them.
-- §4's week is "3 × strength, 2 × zone-2, 9-10k steps" — two thirds of it was
-- unrepresentable.
--
-- Deliberately not a training log for cyclists. Minutes is the field that
-- matters; distance and heart rate are there when the athlete has them and
-- absent when they do not.
create table cardio_sessions (
  id            serial primary key,
  user_id       int not null references users(id) on delete cascade,
  performed_at  timestamptz not null default now(),
  context_id    int references contexts(id),
  kind          text not null check (kind in ('zone2', 'intervals', 'sport', 'walk', 'other')),
  minutes       int not null check (minutes between 1 and 600),
  description   text,
  distance_km   numeric,
  avg_hr        int check (avg_hr between 30 and 240),
  rpe           int check (rpe between 1 and 10),
  created_at    timestamptz not null default now()
);

create index cardio_user_performed_idx on cardio_sessions (user_id, performed_at desc);
