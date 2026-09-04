-- Seed data per CLAUDE.md §4 "Seed data" and §5 "Rules".

-- Placeholder numbers. The first account overwrites all of them during
-- onboarding, which computes targets from the body actually in front of it
-- (services/onboarding.ts). Nothing downstream reads these as defaults.
insert into profile (id, height_cm, goal_weight_kg, calorie_target, protein_target_g, fat_floor_g)
values (1, 180, 75, 2200, 165, 65);

-- Four places, because the athlete this was first built for trained in four
-- cities and the whole point of a context is that equipment and food change
-- with the city. The names are placeholders — everyone renames them, and a
-- second account seeds Home alone. All four are gym-capable; only Home
-- changes the food picture.
insert into contexts (name, equipment, food_profile, is_active) values
  ('Home',
   '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}',
   '{"dinner": "moms_food_half_plus_protein"}',
   true),
  ('City A',
   '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}',
   '{"dinner": "own"}',
   false),
  ('City B',
   '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}',
   '{"dinner": "own"}',
   false),
  ('City C',
   '{"gym": true, "partner": "hansefit", "notes": "Hansefit BEST — unlimited nationwide check-ins"}',
   '{"dinner": "own"}',
   false);

-- The exercise library. Bigger than the three templates need, because the
-- extras are what swap_exercise reaches for in an unfamiliar Hansefit gym.
insert into exercises (name, pattern) values
  ('Back Squat',                      'squat'),
  ('Leg Press',                       'squat'),
  ('Hack Squat',                      'squat'),
  ('Smith Machine Squat',             'squat'),
  ('Goblet Squat',                    'squat'),
  ('Bulgarian Split Squat',           'squat'),

  ('Romanian Deadlift',               'hinge'),
  ('Hip Thrust',                      'hinge'),
  ('Back Extension',                  'hinge'),

  ('Chest Press Machine',             'h_push'),
  ('Incline Dumbbell Press',          'h_push'),
  ('Flat Dumbbell Bench Press',       'h_push'),
  ('Barbell Bench Press',             'h_push'),

  ('Overhead Press',                  'v_push'),
  ('Seated Dumbbell Shoulder Press',  'v_push'),
  ('Machine Shoulder Press',          'v_push'),

  ('Seated Cable Row',                'h_pull'),
  ('Chest-Supported Row',             'h_pull'),
  ('Barbell Row',                     'h_pull'),
  ('Single-Arm Dumbbell Row',         'h_pull'),

  ('Lat Pulldown',                    'v_pull'),
  ('Pull-up',                         'v_pull'),
  ('Assisted Pull-up',                'v_pull'),

  ('Seated Leg Curl',                 'iso'),
  ('Leg Extension',                   'iso'),
  ('Lateral Raise',                   'iso'),
  ('Cable Lateral Raise',             'iso'),
  ('Face Pull',                       'iso'),
  ('Rear Delt Fly',                   'iso'),
  ('Dumbbell Biceps Curl',            'iso'),
  ('Barbell Curl',                    'iso'),
  ('Cable Triceps Pushdown',          'iso'),
  ('Overhead Cable Triceps Extension','iso'),
  ('Cable Fly',                       'iso'),
  ('Pec Deck',                        'iso');

-- Substitutes, in preference order. Always within the same movement pattern.
with pairs (exercise, substitute, rank) as (values
  ('Back Squat',                      'Hack Squat',                       1),
  ('Back Squat',                      'Leg Press',                        2),
  ('Back Squat',                      'Smith Machine Squat',              3),
  ('Back Squat',                      'Goblet Squat',                     4),
  ('Leg Press',                       'Hack Squat',                       1),
  ('Leg Press',                       'Back Squat',                       2),
  ('Leg Press',                       'Smith Machine Squat',              3),
  ('Hack Squat',                      'Leg Press',                        1),
  ('Hack Squat',                      'Back Squat',                       2),
  ('Hack Squat',                      'Smith Machine Squat',              3),
  ('Smith Machine Squat',             'Back Squat',                       1),
  ('Smith Machine Squat',             'Hack Squat',                       2),
  ('Smith Machine Squat',             'Leg Press',                        3),
  ('Goblet Squat',                    'Bulgarian Split Squat',            1),
  ('Goblet Squat',                    'Leg Press',                        2),
  ('Bulgarian Split Squat',           'Goblet Squat',                     1),
  ('Bulgarian Split Squat',           'Leg Press',                        2),

  ('Romanian Deadlift',               'Hip Thrust',                       1),
  ('Romanian Deadlift',               'Back Extension',                   2),
  ('Hip Thrust',                      'Romanian Deadlift',                1),
  ('Hip Thrust',                      'Back Extension',                   2),
  ('Back Extension',                  'Romanian Deadlift',                1),
  ('Back Extension',                  'Hip Thrust',                       2),

  ('Chest Press Machine',             'Barbell Bench Press',              1),
  ('Chest Press Machine',             'Flat Dumbbell Bench Press',        2),
  ('Chest Press Machine',             'Incline Dumbbell Press',           3),
  ('Incline Dumbbell Press',          'Chest Press Machine',              1),
  ('Incline Dumbbell Press',          'Flat Dumbbell Bench Press',        2),
  ('Incline Dumbbell Press',          'Barbell Bench Press',              3),
  ('Flat Dumbbell Bench Press',       'Barbell Bench Press',              1),
  ('Flat Dumbbell Bench Press',       'Chest Press Machine',              2),
  ('Barbell Bench Press',             'Flat Dumbbell Bench Press',        1),
  ('Barbell Bench Press',             'Chest Press Machine',              2),

  ('Overhead Press',                  'Seated Dumbbell Shoulder Press',   1),
  ('Overhead Press',                  'Machine Shoulder Press',           2),
  ('Seated Dumbbell Shoulder Press',  'Overhead Press',                   1),
  ('Seated Dumbbell Shoulder Press',  'Machine Shoulder Press',           2),
  ('Machine Shoulder Press',          'Seated Dumbbell Shoulder Press',   1),
  ('Machine Shoulder Press',          'Overhead Press',                   2),

  ('Seated Cable Row',                'Chest-Supported Row',              1),
  ('Seated Cable Row',                'Single-Arm Dumbbell Row',          2),
  ('Seated Cable Row',                'Barbell Row',                      3),
  ('Chest-Supported Row',             'Seated Cable Row',                 1),
  ('Chest-Supported Row',             'Single-Arm Dumbbell Row',          2),
  ('Chest-Supported Row',             'Barbell Row',                      3),
  ('Barbell Row',                     'Chest-Supported Row',              1),
  ('Barbell Row',                     'Seated Cable Row',                 2),
  ('Single-Arm Dumbbell Row',         'Chest-Supported Row',              1),
  ('Single-Arm Dumbbell Row',         'Seated Cable Row',                 2),

  ('Lat Pulldown',                    'Assisted Pull-up',                 1),
  ('Lat Pulldown',                    'Pull-up',                          2),
  ('Pull-up',                         'Assisted Pull-up',                 1),
  ('Pull-up',                         'Lat Pulldown',                     2),
  ('Assisted Pull-up',                'Lat Pulldown',                     1),
  ('Assisted Pull-up',                'Pull-up',                          2),

  ('Lateral Raise',                   'Cable Lateral Raise',              1),
  ('Cable Lateral Raise',             'Lateral Raise',                    1),
  ('Face Pull',                       'Rear Delt Fly',                    1),
  ('Rear Delt Fly',                   'Face Pull',                        1),
  ('Dumbbell Biceps Curl',            'Barbell Curl',                     1),
  ('Barbell Curl',                    'Dumbbell Biceps Curl',             1),
  ('Cable Triceps Pushdown',          'Overhead Cable Triceps Extension', 1),
  ('Overhead Cable Triceps Extension','Cable Triceps Pushdown',           1),
  ('Cable Fly',                       'Pec Deck',                         1),
  ('Pec Deck',                        'Cable Fly',                        1),
  ('Seated Leg Curl',                 'Romanian Deadlift',                1),
  ('Leg Extension',                   'Hack Squat',                       1)
)
update exercises e
set substitutes = sub.ids
from (
  select p.exercise, array_agg(s.id order by p.rank) as ids
  from pairs p
  join exercises s on s.name = p.substitute
  group by p.exercise
) sub
where e.name = sub.exercise;

-- Rules per §5. Phase 4 ships the editor; the data is stated now so the
-- validator has something real to run against.
insert into rules (tier, text, scope) values
  ('hard',  'Breakfast is always ~500g Skyr with berries and 40g oats. No substitutions.', null),
  ('hard',  'When context is Home, dinner is half a portion of mom''s food plus a protein add-on (200g Magerquark, chicken breast, or a shake).', 'Home'),
  ('soft',  'Prefer soy chunks as a protein source when cooking — cheap and already a staple.', null),
  ('soft',  'Prefer treadmill over outdoor running.', null),
  ('soft',  'Weekly movement targets, not fixed weekdays — travel makes fixed days fail.', null),
  ('never', 'Never propose a day under 160g protein.', null),
  ('never', 'Never schedule hard intervals on a football day.', null);
