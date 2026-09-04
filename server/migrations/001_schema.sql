-- Schema per CLAUDE.md §4. One user, no tenancy, no soft deletes.

-- one row, the athlete
create table profile (
  id                int primary key default 1,
  height_cm         int not null,
  birth_year        int,
  goal_weight_kg    numeric,
  calorie_target    int not null,
  protein_target_g  int not null,
  fat_floor_g       int not null,
  updated_at        timestamptz default now(),
  constraint profile_is_singleton check (id = 1)
);

-- The athlete's places: home, and wherever else they train
create table contexts (
  id            serial primary key,
  name          text not null unique,
  equipment     jsonb not null,   -- {"gym": true, "partner": "hansefit", "notes": "..."}
  food_profile  jsonb not null,   -- {"dinner": "moms_food_half_plus_protein"}
  is_active     boolean default false
);

create table exercises (
  id           serial primary key,
  name         text not null,
  pattern      text not null,     -- squat|hinge|h_push|v_push|h_pull|v_pull|iso
  substitutes  int[] default '{}' -- for equipment-constrained swaps
);

create unique index exercises_name_key on exercises (name);
alter table exercises add constraint exercises_pattern_valid
  check (pattern in ('squat','hinge','h_push','v_push','h_pull','v_pull','iso'));

create table sessions (
  id           serial primary key,
  performed_at timestamptz not null,
  context_id   int references contexts(id),
  template     text,              -- 'A' | 'B' | 'C'
  rpe          int,
  notes        text,
  joint_pain   boolean default false
);

create index sessions_performed_at_idx on sessions (performed_at desc);

create table sets (
  id           serial primary key,
  session_id   int references sessions(id) on delete cascade,
  exercise_id  int references exercises(id),
  set_index    int not null,
  weight_kg    numeric,
  reps         int,
  rir          int
);

create index sets_session_id_idx on sets (session_id);

-- Additive: makes a set confirm idempotent by natural key, so an offline queue
-- draining twice cannot double-write. See docs/offline-sync.md.
create unique index sets_natural_key on sets (session_id, exercise_id, set_index);

create table bodyweight (
  measured_on  date primary key,
  weight_kg    numeric not null
);

create table meals (
  id           serial primary key,
  eaten_at     timestamptz not null,
  slot         text not null,     -- breakfast|lunch|dinner|snack
  description  text,
  kcal         int,
  protein_g    int,
  source       text               -- 'moms_food' | 'own' | 'other'
);

create index meals_eaten_at_idx on meals (eaten_at desc);

create table fridge_inventory (
  id           serial primary key,
  captured_at  timestamptz not null,
  context_id   int references contexts(id),
  items        jsonb not null     -- [{name, qty, confidence, confirmed}]
);

create table rules (
  id        serial primary key,
  tier      text not null check (tier in ('hard','soft','never')),
  text      text not null,
  scope     text,                 -- null = always, else context name
  active    boolean default true
);

create table chat_messages (
  id         bigserial primary key,
  role       text not null,       -- user|model|tool
  content    jsonb not null,
  created_at timestamptz default now()
);

-- Additive: idempotency ledger for the offline sync queue. Each queued write
-- carries a client-generated uuid; a replay returns the stored result instead
-- of writing again.
create table sync_log (
  client_id   uuid primary key,
  op          text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
