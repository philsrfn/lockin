-- Two changes to the movement library, and they belong together.
--
-- WHAT WAS WRONG WITH IT
--
-- Fifty-two movements, chosen twice for two specific problems: 002 picked what
-- one man's three templates needed plus enough to swap inside a Hansefit gym,
-- and 016 added what a hotel room with two dumbbells could do. Both were the
-- right size for the question being asked at the time.
--
-- Neither was asked "what does somebody who is not him want to train". The
-- answer is visible as holes rather than as gaps: no deadlift of any kind, no
-- calf raise, no abdominal work at all, nothing for forearms, one curl
-- variation and one pushdown. Somebody arriving from another app opens the
-- picker, searches for the movement they have been doing for two years, finds
-- nothing, and concludes the app cannot do it. That is the first five minutes
-- of §17's stranger, and it is the cheapest one to fix.
--
-- So: seventy-six more, curated rather than imported. A public dataset of 870
-- exercises exists and is where the pictures come from; pouring all of it in
-- would have made the picker a search box with no browsable middle, and left
-- every one of them needing a movement pattern, an equipment list and a
-- substitute chain that nobody had actually looked at. §14 — a seeded catalog
-- plus swap_exercise covers it — still holds. It just needs a longer seed.
--
-- WHY THAT FORCED THE SECOND CHANGE
--
-- A catalogue can be as long as you like and will still be missing somebody's
-- movement: a machine only their gym has, a rehab exercise a physiotherapist
-- gave them, the thing their club calls by a different name. 011 wrote that
-- off as "per-user exercises are a Phase 2 concern" while there was one user
-- and a way to add a row with psql. For a stranger it is the difference
-- between an app that logs their training and an app that logs most of it.
--
-- The shape is the one `programs` already uses, deliberately: `user_id` null
-- means the shared catalogue, set means theirs, and reading is both. That is
-- not just economy — it is what keeps `sets.exercise_id` and
-- `program_slots.exercise_id` working unchanged. A movement somebody invented
-- goes into a programme, gets sets logged against it, appears in their history
-- and in progress, and none of the code that does those things has to know
-- where it came from.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- A tool for the trainer to create one. §6 says `edit_program` resolves every
-- name against the library so that a movement the model invented fails loudly;
-- a create tool would turn that guard into a no-op, because the model could
-- always make the name real first. Movements come from the athlete's hands.

alter table exercises add column user_id int references users(id) on delete cascade;

-- The name was globally unique, which is right for a shared catalogue and
-- wrong the moment two athletes both invent "Trap Bar Row". Two partial
-- indexes instead — the same pair `programs_slug_key` has used since 015.
--
-- Dropping an index is not dropping data (§15): no column loses a value and
-- every row that satisfied the old constraint satisfies the new ones. The
-- replacements are created first so the name is never briefly unprotected.
create unique index exercises_catalogue_name_key on exercises (name) where user_id is null;
create unique index exercises_own_name_key on exercises (user_id, name) where user_id is not null;
drop index exercises_name_key;

-- --- the movements ----------------------------------------------------------
--
-- Equipment uses the vocabulary 016 established, plus three tokens it had no
-- reason to invent: `kettlebell`, `dip_bars`, `ab_wheel`. A place that has not
-- said what it has can still do everything (see availableAt in
-- services/exercises.ts), so this narrows nothing that was previously open —
-- it only stops a hotel room being offered a dip station.

insert into exercises (name, pattern, equipment) values
  -- Squat. The catalogue had six ways to do it and all of them were a machine
  -- or a bar on the back; the front squat and the loaded lunge are what the
  -- other half of the internet trains.
  ('Front Squat',                    'squat',  array['barbell','rack']),
  ('Barbell Lunge',                  'squat',  array['barbell']),
  ('Reverse Lunge',                  'squat',  array['dumbbell']),
  ('Box Squat',                      'squat',  array['barbell','rack','bench']),
  ('Sissy Squat',                    'squat',  array['bodyweight']),

  -- Hinge. The largest hole: the app could not log a deadlift. Three bars and
  -- three stances, because "deadlift" means a different lift to each of them
  -- and averaging their loads would be nonsense.
  ('Conventional Deadlift',          'hinge',  array['barbell']),
  ('Sumo Deadlift',                  'hinge',  array['barbell']),
  ('Trap Bar Deadlift',              'hinge',  array['barbell']),
  ('Stiff-Legged Deadlift',          'hinge',  array['barbell']),
  ('Good Morning',                   'hinge',  array['barbell','rack']),
  ('Single-Leg Romanian Deadlift',   'hinge',  array['dumbbell']),
  ('Kettlebell Swing',               'hinge',  array['kettlebell']),

  ('Incline Barbell Bench Press',    'h_push', array['barbell','bench','rack']),
  ('Decline Barbell Bench Press',    'h_push', array['barbell','bench','rack']),
  ('Close-Grip Bench Press',         'h_push', array['barbell','bench','rack']),
  ('Smith Machine Bench Press',      'h_push', array['machine','bench']),
  ('Decline Dumbbell Press',         'h_push', array['dumbbell','bench']),
  ('Chest Dip',                      'h_push', array['dip_bars']),

  ('Seated Barbell Overhead Press',  'v_push', array['barbell','bench','rack']),
  ('Push Press',                     'v_push', array['barbell','rack']),
  ('Arnold Press',                   'v_push', array['dumbbell','bench']),
  ('Single-Arm Dumbbell Shoulder Press', 'v_push', array['dumbbell']),
  ('Smith Machine Shoulder Press',   'v_push', array['machine']),

  ('T-Bar Row',                      'h_pull', array['machine']),
  ('Machine Row',                    'h_pull', array['machine']),
  ('Smith Machine Row',              'h_pull', array['machine']),
  ('Single-Arm Cable Row',           'h_pull', array['cable']),
  ('Reverse-Grip Barbell Row',       'h_pull', array['barbell']),
  ('Incline Dumbbell Row',           'h_pull', array['dumbbell','bench']),

  -- Grip is not a detail on a pulldown: it is which muscle does the work, and
  -- the loads are far enough apart that logging them as one movement would
  -- make progression lie.
  ('Close-Grip Lat Pulldown',        'v_pull', array['cable']),
  ('Neutral-Grip Lat Pulldown',      'v_pull', array['cable']),
  ('Underhand Lat Pulldown',         'v_pull', array['cable']),
  ('Single-Arm Lat Pulldown',        'v_pull', array['cable']),
  ('Wide-Grip Pull-up',              'v_pull', array['pullup_bar']),

  -- Shoulders and traps.
  ('Front Raise',                    'iso',    array['dumbbell']),
  ('Upright Row',                    'iso',    array['barbell']),
  ('Reverse Pec Deck',               'iso',    array['machine']),
  ('Barbell Shrug',                  'iso',    array['barbell']),
  ('Dumbbell Shrug',                 'iso',    array['dumbbell']),

  -- Biceps. One curl was not a library, it was a placeholder.
  ('Preacher Curl',                  'iso',    array['barbell','bench']),
  ('Incline Dumbbell Curl',          'iso',    array['dumbbell','bench']),
  ('Cable Biceps Curl',              'iso',    array['cable']),
  ('Concentration Curl',             'iso',    array['dumbbell','bench']),
  ('Reverse Curl',                   'iso',    array['barbell']),
  ('Machine Biceps Curl',            'iso',    array['machine']),
  ('Spider Curl',                    'iso',    array['dumbbell','bench']),

  -- Triceps.
  ('Rope Triceps Pushdown',          'iso',    array['cable']),
  ('Overhead Dumbbell Triceps Extension', 'iso', array['dumbbell']),
  ('Lying Barbell Triceps Extension','iso',    array['barbell','bench']),
  ('Machine Triceps Extension',      'iso',    array['machine']),
  ('Triceps Kickback',               'iso',    array['dumbbell']),
  ('Close-Grip Push-up',             'iso',    array['bodyweight']),
  ('Triceps Dip',                    'iso',    array['dip_bars']),

  ('Dumbbell Fly',                   'iso',    array['dumbbell','bench']),
  ('Incline Dumbbell Fly',           'iso',    array['dumbbell','bench']),
  ('Straight-Arm Pulldown',          'iso',    array['cable']),
  ('Dumbbell Pullover',              'iso',    array['dumbbell','bench']),

  -- Legs. Calves had nothing at all, which is a strange thing for a training
  -- app to be missing for a year.
  ('Lying Leg Curl',                 'iso',    array['machine']),
  ('Standing Calf Raise',            'iso',    array['machine']),
  ('Seated Calf Raise',              'iso',    array['machine']),
  ('Leg Press Calf Raise',           'iso',    array['machine']),
  ('Hip Abduction',                  'iso',    array['machine']),
  ('Hip Adduction',                  'iso',    array['machine']),
  ('Glute Kickback',                 'iso',    array['cable']),

  -- Core. Logged with reps and no weight, which the logger already handles:
  -- a bodyweight movement has always been allowed to carry a null load.
  ('Crunch',                         'iso',    array['bodyweight']),
  ('Bicycle Crunch',                 'iso',    array['bodyweight']),
  ('Russian Twist',                  'iso',    array['bodyweight']),
  ('Plank',                          'iso',    array['bodyweight']),
  ('Side Plank',                     'iso',    array['bodyweight']),
  ('Decline Sit-up',                 'iso',    array['bench']),
  ('Hanging Leg Raise',              'iso',    array['pullup_bar']),
  ('Cable Crunch',                   'iso',    array['cable']),
  ('Ab Crunch Machine',              'iso',    array['machine']),
  ('Ab Wheel Rollout',               'iso',    array['ab_wheel']),

  ('Wrist Curl',                     'iso',    array['barbell','bench']),
  ('Farmer''s Walk',                 'iso',    array['dumbbell'])
on conflict do nothing;

-- --- substitutes ------------------------------------------------------------
--
-- A movement with no substitutes is a movement the swap button cannot help
-- with, which in an unfamiliar gym is the moment somebody skips it. Always
-- inside the same pattern, in preference order, and every chain ends somewhere
-- that needs less equipment than it started with.

with pairs (exercise, substitute, rank) as (values
  ('Front Squat',                   'Back Squat',                      1),
  ('Front Squat',                   'Goblet Squat',                    2),
  ('Front Squat',                   'Hack Squat',                      3),
  ('Barbell Lunge',                 'Walking Lunge',                   1),
  ('Barbell Lunge',                 'Bulgarian Split Squat',           2),
  ('Reverse Lunge',                 'Walking Lunge',                   1),
  ('Reverse Lunge',                 'Bulgarian Split Squat',           2),
  ('Box Squat',                     'Back Squat',                      1),
  ('Box Squat',                     'Leg Press',                       2),
  ('Sissy Squat',                   'Leg Extension',                   1),
  ('Sissy Squat',                   'Bodyweight Squat',                2),

  ('Conventional Deadlift',         'Trap Bar Deadlift',               1),
  ('Conventional Deadlift',         'Sumo Deadlift',                   2),
  ('Conventional Deadlift',         'Romanian Deadlift',               3),
  ('Sumo Deadlift',                 'Conventional Deadlift',           1),
  ('Sumo Deadlift',                 'Trap Bar Deadlift',               2),
  ('Trap Bar Deadlift',             'Conventional Deadlift',           1),
  ('Trap Bar Deadlift',             'Romanian Deadlift',               2),
  ('Stiff-Legged Deadlift',         'Romanian Deadlift',               1),
  ('Stiff-Legged Deadlift',         'Good Morning',                    2),
  ('Good Morning',                  'Romanian Deadlift',               1),
  ('Good Morning',                  'Back Extension',                  2),
  ('Single-Leg Romanian Deadlift',  'Dumbbell Romanian Deadlift',      1),
  ('Single-Leg Romanian Deadlift',  'Glute Bridge',                    2),
  ('Kettlebell Swing',              'Dumbbell Romanian Deadlift',      1),
  ('Kettlebell Swing',              'Glute Bridge',                    2),

  ('Incline Barbell Bench Press',   'Incline Dumbbell Press',          1),
  ('Incline Barbell Bench Press',   'Barbell Bench Press',             2),
  ('Incline Barbell Bench Press',   'Incline Push-up',                 3),
  ('Decline Barbell Bench Press',   'Decline Dumbbell Press',          1),
  ('Decline Barbell Bench Press',   'Barbell Bench Press',             2),
  ('Close-Grip Bench Press',        'Barbell Bench Press',             1),
  ('Close-Grip Bench Press',        'Dumbbell Floor Press',            2),
  ('Smith Machine Bench Press',     'Barbell Bench Press',             1),
  ('Smith Machine Bench Press',     'Chest Press Machine',             2),
  ('Decline Dumbbell Press',        'Flat Dumbbell Bench Press',       1),
  ('Decline Dumbbell Press',        'Decline Barbell Bench Press',     2),
  ('Chest Dip',                     'Barbell Bench Press',             1),
  ('Chest Dip',                     'Push-up',                         2),

  ('Seated Barbell Overhead Press', 'Overhead Press',                  1),
  ('Seated Barbell Overhead Press', 'Seated Dumbbell Shoulder Press',  2),
  ('Push Press',                    'Overhead Press',                  1),
  ('Push Press',                    'Machine Shoulder Press',          2),
  ('Arnold Press',                  'Seated Dumbbell Shoulder Press',  1),
  ('Arnold Press',                  'Machine Shoulder Press',          2),
  ('Single-Arm Dumbbell Shoulder Press', 'Seated Dumbbell Shoulder Press', 1),
  ('Single-Arm Dumbbell Shoulder Press', 'Pike Push-up',               2),
  ('Smith Machine Shoulder Press',  'Machine Shoulder Press',          1),
  ('Smith Machine Shoulder Press',  'Overhead Press',                  2),

  ('T-Bar Row',                     'Chest-Supported Row',             1),
  ('T-Bar Row',                     'Barbell Row',                     2),
  ('T-Bar Row',                     'Seated Cable Row',                3),
  ('Machine Row',                   'Chest-Supported Row',             1),
  ('Machine Row',                   'Seated Cable Row',                2),
  ('Smith Machine Row',             'Barbell Row',                     1),
  ('Smith Machine Row',             'Chest-Supported Row',             2),
  ('Single-Arm Cable Row',          'Single-Arm Dumbbell Row',         1),
  ('Single-Arm Cable Row',          'Seated Cable Row',                2),
  ('Reverse-Grip Barbell Row',      'Barbell Row',                     1),
  ('Reverse-Grip Barbell Row',      'Seated Cable Row',                2),
  ('Incline Dumbbell Row',          'Chest-Supported Row',             1),
  ('Incline Dumbbell Row',          'Single-Arm Dumbbell Row',         2),

  ('Close-Grip Lat Pulldown',       'Lat Pulldown',                    1),
  ('Close-Grip Lat Pulldown',       'Chin-up',                         2),
  ('Neutral-Grip Lat Pulldown',     'Lat Pulldown',                    1),
  ('Neutral-Grip Lat Pulldown',     'Chin-up',                         2),
  ('Underhand Lat Pulldown',        'Lat Pulldown',                    1),
  ('Underhand Lat Pulldown',        'Chin-up',                         2),
  ('Single-Arm Lat Pulldown',       'Lat Pulldown',                    1),
  ('Single-Arm Lat Pulldown',       'Assisted Pull-up',                2),
  ('Wide-Grip Pull-up',             'Pull-up',                         1),
  ('Wide-Grip Pull-up',             'Lat Pulldown',                    2),

  ('Front Raise',                   'Lateral Raise',                   1),
  ('Upright Row',                   'Lateral Raise',                   1),
  ('Upright Row',                   'Face Pull',                       2),
  ('Reverse Pec Deck',              'Rear Delt Fly',                   1),
  ('Reverse Pec Deck',              'Face Pull',                       2),
  ('Barbell Shrug',                 'Dumbbell Shrug',                  1),
  ('Dumbbell Shrug',                'Barbell Shrug',                   1),

  ('Preacher Curl',                 'Barbell Curl',                    1),
  ('Preacher Curl',                 'Machine Biceps Curl',             2),
  ('Incline Dumbbell Curl',         'Dumbbell Biceps Curl',            1),
  ('Incline Dumbbell Curl',         'Cable Biceps Curl',               2),
  ('Cable Biceps Curl',             'Dumbbell Biceps Curl',            1),
  ('Cable Biceps Curl',             'Barbell Curl',                    2),
  ('Concentration Curl',            'Dumbbell Biceps Curl',            1),
  ('Reverse Curl',                  'Dumbbell Hammer Curl',            1),
  ('Reverse Curl',                  'Barbell Curl',                    2),
  ('Machine Biceps Curl',           'Dumbbell Biceps Curl',            1),
  ('Spider Curl',                   'Preacher Curl',                   1),
  ('Spider Curl',                   'Dumbbell Biceps Curl',            2),

  ('Rope Triceps Pushdown',         'Cable Triceps Pushdown',          1),
  ('Rope Triceps Pushdown',         'Dumbbell Skull Crusher',          2),
  ('Overhead Dumbbell Triceps Extension', 'Overhead Cable Triceps Extension', 1),
  ('Overhead Dumbbell Triceps Extension', 'Dumbbell Skull Crusher',    2),
  ('Lying Barbell Triceps Extension', 'Dumbbell Skull Crusher',        1),
  ('Lying Barbell Triceps Extension', 'Cable Triceps Pushdown',        2),
  ('Machine Triceps Extension',     'Cable Triceps Pushdown',          1),
  ('Triceps Kickback',              'Cable Triceps Pushdown',          1),
  ('Triceps Kickback',              'Bench Dip',                       2),
  ('Close-Grip Push-up',            'Bench Dip',                       1),
  ('Triceps Dip',                   'Bench Dip',                       1),
  ('Triceps Dip',                   'Cable Triceps Pushdown',          2),

  ('Dumbbell Fly',                  'Cable Fly',                       1),
  ('Dumbbell Fly',                  'Pec Deck',                        2),
  ('Incline Dumbbell Fly',          'Dumbbell Fly',                    1),
  ('Incline Dumbbell Fly',          'Cable Fly',                       2),
  ('Straight-Arm Pulldown',         'Dumbbell Pullover',               1),
  ('Dumbbell Pullover',             'Straight-Arm Pulldown',           1),

  ('Lying Leg Curl',                'Seated Leg Curl',                 1),
  ('Lying Leg Curl',                'Nordic Curl',                     2),
  ('Standing Calf Raise',           'Seated Calf Raise',               1),
  ('Standing Calf Raise',           'Leg Press Calf Raise',            2),
  ('Seated Calf Raise',             'Standing Calf Raise',             1),
  ('Leg Press Calf Raise',          'Standing Calf Raise',             1),
  ('Hip Abduction',                 'Glute Kickback',                  1),
  ('Hip Adduction',                 'Hip Abduction',                   1),
  ('Glute Kickback',                'Glute Bridge',                    1),

  ('Crunch',                        'Bicycle Crunch',                  1),
  ('Crunch',                        'Cable Crunch',                    2),
  ('Bicycle Crunch',                'Crunch',                          1),
  ('Russian Twist',                 'Side Plank',                      1),
  ('Plank',                         'Side Plank',                      1),
  ('Side Plank',                    'Plank',                           1),
  ('Decline Sit-up',                'Crunch',                          1),
  ('Hanging Leg Raise',             'Crunch',                          1),
  ('Cable Crunch',                  'Crunch',                          1),
  ('Cable Crunch',                  'Ab Crunch Machine',               2),
  ('Ab Crunch Machine',             'Cable Crunch',                    1),
  ('Ab Crunch Machine',             'Crunch',                          2),
  ('Ab Wheel Rollout',              'Plank',                           1),

  ('Wrist Curl',                    'Dumbbell Hammer Curl',            1),
  ('Farmer''s Walk',                'Dumbbell Shrug',                  1)
)
update exercises e
set substitutes = sub.ids
from (
  select p.exercise, array_agg(s.id order by p.rank) as ids
  from pairs p join exercises s on s.name = p.substitute and s.user_id is null
  group by p.exercise
) sub
where e.name = sub.exercise and e.user_id is null;

-- And the other direction: what the movements that were already here should
-- offer now that there is more to offer. Appended rather than replaced, so
-- 002's and 016's preference orders survive and these land behind them.
with extra (exercise, substitute) as (values
  ('Back Squat',                    'Front Squat'),
  ('Romanian Deadlift',             'Conventional Deadlift'),
  ('Romanian Deadlift',             'Stiff-Legged Deadlift'),
  ('Hip Thrust',                    'Kettlebell Swing'),
  ('Barbell Bench Press',           'Incline Barbell Bench Press'),
  ('Barbell Bench Press',           'Close-Grip Bench Press'),
  ('Incline Dumbbell Press',        'Incline Barbell Bench Press'),
  ('Chest Press Machine',           'Smith Machine Bench Press'),
  ('Overhead Press',                'Seated Barbell Overhead Press'),
  ('Overhead Press',                'Push Press'),
  ('Seated Dumbbell Shoulder Press','Arnold Press'),
  ('Seated Cable Row',              'Machine Row'),
  ('Seated Cable Row',              'T-Bar Row'),
  ('Chest-Supported Row',           'T-Bar Row'),
  ('Barbell Row',                   'T-Bar Row'),
  ('Single-Arm Dumbbell Row',       'Single-Arm Cable Row'),
  ('Lat Pulldown',                  'Neutral-Grip Lat Pulldown'),
  ('Lat Pulldown',                  'Close-Grip Lat Pulldown'),
  ('Pull-up',                       'Wide-Grip Pull-up'),
  ('Seated Leg Curl',               'Lying Leg Curl'),
  ('Lateral Raise',                 'Front Raise'),
  ('Rear Delt Fly',                 'Reverse Pec Deck'),
  ('Face Pull',                     'Reverse Pec Deck'),
  ('Dumbbell Biceps Curl',          'Cable Biceps Curl'),
  ('Barbell Curl',                  'Preacher Curl'),
  ('Cable Triceps Pushdown',        'Rope Triceps Pushdown'),
  ('Overhead Cable Triceps Extension', 'Overhead Dumbbell Triceps Extension'),
  ('Cable Fly',                     'Dumbbell Fly'),
  ('Pec Deck',                      'Dumbbell Fly'),
  ('Leg Extension',                 'Sissy Squat'),
  ('Bench Dip',                     'Triceps Dip')
)
update exercises e
set substitutes = e.substitutes || sub.ids
from (
  select x.exercise, array_agg(s.id) as ids
  from extra x join exercises s on s.name = x.substitute and s.user_id is null
  group by x.exercise
) sub
where e.name = sub.exercise
  and e.user_id is null
  and not (sub.ids <@ e.substitutes);

-- --- tenancy ----------------------------------------------------------------
--
-- `shared` on purpose, the same way `programs` is: a null user_id is the
-- catalogue and everybody reads it. The `with check` half of the policy is not
-- shared, which is the part that matters — a write must name a tenant, so
-- nothing running as an athlete can add a row to the shared catalogue.
--
-- This runs last. 028's loop found every table carrying a user_id at the time
-- and has already run everywhere; a column added afterwards has to ask for
-- itself, and src/__tests__/rls.int.test.ts is what fails if it forgets.
select apply_tenant_policy('exercises', true);
