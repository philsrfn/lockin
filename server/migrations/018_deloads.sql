-- Planned deloads, and body measurements.
--
-- progression.ts already deloads a movement after two failed sessions. That is
-- a repair. A programme somebody runs for a year also needs the other kind — a
-- light week that arrives on schedule, while everything still feels fine.
create table deloads (
  user_id       int not null references users(id) on delete cascade,
  -- Monday of the week it covers, in the athlete's own zone.
  week_starting date not null,
  reason        text not null default 'scheduled',
  created_at    timestamptz not null default now(),
  primary key (user_id, week_starting)
);

alter table profile add column deload_every_weeks int not null default 8
  check (deload_every_weeks between 0 and 52);

-- Weight alone stalls for a fortnight while the mirror keeps changing. A waist
-- measurement is what carries people through a flat stretch — and unlike
-- photos, it needs no object storage to be useful today.
create table measurements (
  user_id      int not null references users(id) on delete cascade,
  measured_on  date not null,
  waist_cm     numeric,
  hip_cm       numeric,
  chest_cm     numeric,
  arm_cm       numeric,
  thigh_cm     numeric,
  notes        text,
  created_at   timestamptz not null default now(),
  primary key (user_id, measured_on)
);
