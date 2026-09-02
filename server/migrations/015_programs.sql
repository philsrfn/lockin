-- The training programme becomes data.
--
-- Three full-body days on rotation were hardcoded in domain/templates.ts, and
-- §14 still stands: this is not a program builder. It is a short catalogue of
-- programmes that work, chosen once, with the same rotation underneath. What
-- changes is that "three full-body days" stops being the only answer — it is
-- the wrong shape for somebody who can train four or five times a week.
--
-- Rotation, not weekdays: a programme is an ordered list of days that cycles.
-- How often it cycles is how often you train, which is a separate question and
-- already on the profile.

create table programs (
  id            serial primary key,
  -- null = built in, shared by everyone. A user's own programme would carry
  -- their id; nothing creates one yet, and §14 says think hard before it does.
  user_id       int references users(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text not null,
  /** What it is designed around. Not a cap — the §7 rest-day floor is that. */
  days_per_week int not null check (days_per_week between 1 and 7),
  created_at    timestamptz not null default now()
);

create unique index programs_slug_key on programs (slug) where user_id is null;

create table program_days (
  id          serial primary key,
  program_id  int not null references programs(id) on delete cascade,
  -- Rotation order. A → B → C → A.
  position    int not null,
  -- Stored on sessions.template. Short, because it is history: changing one
  -- would orphan every session already logged against it.
  code        text not null,
  name        text not null,
  unique (program_id, position),
  unique (program_id, code)
);

create table program_slots (
  id              serial primary key,
  program_day_id  int not null references program_days(id) on delete cascade,
  position        int not null,
  exercise_id     int not null references exercises(id),
  sets            int not null check (sets between 1 and 10),
  -- Smallest sensible jump on this movement. Isolations move in halves.
  increment_kg    numeric not null,
  rest_seconds    int not null,
  rep_min         int not null,
  rep_max         int not null,
  unique (program_day_id, position)
);

create index program_days_program_idx on program_days (program_id, position);
create index program_slots_day_idx on program_slots (program_day_id, position);

alter table profile add column program_id int references programs(id);

-- --- the catalogue ----------------------------------------------------------

insert into programs (slug, name, description, days_per_week) values
  ('full_body_3', 'Full body', 'Three full-body days on rotation. The most training per session, and the easiest to keep going when a week falls apart.', 3),
  ('upper_lower_4', 'Upper / Lower', 'Four days, alternating upper and lower. More volume per muscle than full body once you are training four times a week.', 4),
  ('push_pull_legs', 'Push / Pull / Legs', 'Push, pull, legs on rotation. Run it three times a week or five — the rotation does not care which day it is.', 3);

-- Days, in rotation order.
insert into program_days (program_id, position, code, name)
select p.id, d.position, d.code, d.name
from (values
  ('full_body_3',   1, 'A',    'Full body A'),
  ('full_body_3',   2, 'B',    'Full body B'),
  ('full_body_3',   3, 'C',    'Full body C'),
  ('upper_lower_4', 1, 'U1',   'Upper'),
  ('upper_lower_4', 2, 'L1',   'Lower'),
  ('upper_lower_4', 3, 'U2',   'Upper II'),
  ('upper_lower_4', 4, 'L2',   'Lower II'),
  ('push_pull_legs', 1, 'Push', 'Push'),
  ('push_pull_legs', 2, 'Pull', 'Pull'),
  ('push_pull_legs', 3, 'Legs', 'Legs')
) as d(slug, position, code, name)
join programs p on p.slug = d.slug and p.user_id is null;

-- Slots. Exercises are resolved by name against the shared catalogue, so a
-- drifted name fails the migration rather than the app at 07:30.
insert into program_slots
  (program_day_id, position, exercise_id, sets, increment_kg, rest_seconds, rep_min, rep_max)
select pd.id, s.position, e.id, s.sets, s.increment_kg, s.rest_seconds, 6, 12
from (values
  -- Full body A — unchanged from the hardcoded template, so his history and
  -- his next prescription are exactly what they were yesterday.
  ('full_body_3', 'A', 1, 'Back Squat',                      3, 2.5,  180),
  ('full_body_3', 'A', 2, 'Chest Press Machine',             3, 2.5,  150),
  ('full_body_3', 'A', 3, 'Lat Pulldown',                    3, 2.5,  150),
  ('full_body_3', 'A', 4, 'Seated Leg Curl',                 3, 2.5,  90),
  ('full_body_3', 'A', 5, 'Seated Cable Row',                3, 2.5,  120),
  ('full_body_3', 'A', 6, 'Lateral Raise',                   3, 1.25, 60),

  ('full_body_3', 'B', 1, 'Romanian Deadlift',               3, 2.5,  180),
  ('full_body_3', 'B', 2, 'Incline Dumbbell Press',          3, 2.5,  150),
  ('full_body_3', 'B', 3, 'Chest-Supported Row',             3, 2.5,  150),
  ('full_body_3', 'B', 4, 'Bulgarian Split Squat',           3, 2.5,  120),
  ('full_body_3', 'B', 5, 'Face Pull',                       3, 1.25, 60),
  ('full_body_3', 'B', 6, 'Dumbbell Biceps Curl',            3, 1.25, 60),

  ('full_body_3', 'C', 1, 'Hack Squat',                      3, 5,    180),
  ('full_body_3', 'C', 2, 'Overhead Press',                  3, 2.5,  150),
  ('full_body_3', 'C', 3, 'Pull-up',                         3, 2.5,  150),
  ('full_body_3', 'C', 4, 'Hip Thrust',                      3, 5,    120),
  ('full_body_3', 'C', 5, 'Cable Fly',                       3, 1.25, 60),
  ('full_body_3', 'C', 6, 'Cable Triceps Pushdown',          3, 1.25, 60),

  ('upper_lower_4', 'U1', 1, 'Chest Press Machine',          3, 2.5,  150),
  ('upper_lower_4', 'U1', 2, 'Lat Pulldown',                 3, 2.5,  150),
  ('upper_lower_4', 'U1', 3, 'Seated Dumbbell Shoulder Press', 3, 2.5, 150),
  ('upper_lower_4', 'U1', 4, 'Seated Cable Row',             3, 2.5,  120),
  ('upper_lower_4', 'U1', 5, 'Dumbbell Biceps Curl',         3, 1.25, 60),
  ('upper_lower_4', 'U1', 6, 'Cable Triceps Pushdown',       3, 1.25, 60),

  ('upper_lower_4', 'L1', 1, 'Back Squat',                   3, 2.5,  180),
  ('upper_lower_4', 'L1', 2, 'Romanian Deadlift',            3, 2.5,  180),
  ('upper_lower_4', 'L1', 3, 'Seated Leg Curl',              3, 2.5,  90),
  ('upper_lower_4', 'L1', 4, 'Leg Extension',                3, 2.5,  90),

  ('upper_lower_4', 'U2', 1, 'Incline Dumbbell Press',       3, 2.5,  150),
  ('upper_lower_4', 'U2', 2, 'Chest-Supported Row',          3, 2.5,  150),
  ('upper_lower_4', 'U2', 3, 'Overhead Press',               3, 2.5,  150),
  ('upper_lower_4', 'U2', 4, 'Pull-up',                      3, 2.5,  150),
  ('upper_lower_4', 'U2', 5, 'Face Pull',                    3, 1.25, 60),
  ('upper_lower_4', 'U2', 6, 'Barbell Curl',                 3, 1.25, 60),

  ('upper_lower_4', 'L2', 1, 'Leg Press',                    3, 5,    180),
  ('upper_lower_4', 'L2', 2, 'Hip Thrust',                   3, 5,    120),
  ('upper_lower_4', 'L2', 3, 'Bulgarian Split Squat',        3, 2.5,  120),
  ('upper_lower_4', 'L2', 4, 'Back Extension',               3, 2.5,  90),

  ('push_pull_legs', 'Push', 1, 'Barbell Bench Press',       3, 2.5,  180),
  ('push_pull_legs', 'Push', 2, 'Overhead Press',            3, 2.5,  150),
  ('push_pull_legs', 'Push', 3, 'Incline Dumbbell Press',    3, 2.5,  150),
  ('push_pull_legs', 'Push', 4, 'Cable Lateral Raise',       3, 1.25, 60),
  ('push_pull_legs', 'Push', 5, 'Overhead Cable Triceps Extension', 3, 1.25, 60),

  ('push_pull_legs', 'Pull', 1, 'Barbell Row',               3, 2.5,  180),
  ('push_pull_legs', 'Pull', 2, 'Lat Pulldown',              3, 2.5,  150),
  ('push_pull_legs', 'Pull', 3, 'Single-Arm Dumbbell Row',   3, 2.5,  120),
  ('push_pull_legs', 'Pull', 4, 'Rear Delt Fly',             3, 1.25, 60),
  ('push_pull_legs', 'Pull', 5, 'Barbell Curl',              3, 1.25, 60),

  ('push_pull_legs', 'Legs', 1, 'Back Squat',                3, 2.5,  180),
  ('push_pull_legs', 'Legs', 2, 'Romanian Deadlift',         3, 2.5,  180),
  ('push_pull_legs', 'Legs', 3, 'Leg Press',                 3, 5,    150),
  ('push_pull_legs', 'Legs', 4, 'Seated Leg Curl',           3, 2.5,  90),
  ('push_pull_legs', 'Legs', 5, 'Leg Extension',             3, 2.5,  90)
) as s(slug, code, position, exercise_name, sets, increment_kg, rest_seconds)
join programs p on p.slug = s.slug and p.user_id is null
join program_days pd on pd.program_id = p.id and pd.code = s.code
join exercises e on e.name = s.exercise_name;

-- Everyone who is already here is on the programme they have been running.
update profile set program_id = (select id from programs where slug = 'full_body_3');
