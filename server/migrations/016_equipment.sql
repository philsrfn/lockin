-- What a movement needs, and what a place has.
--
-- The substitute list assumed a full commercial gym, because that is what
-- Hansefit gets him. In a hotel room with two dumbbells, every substitute for
-- Back Squat is a machine he does not have — so the swap button offers a
-- choice between things that are not there.
--
-- Additive: an exercise with no equipment listed, or a place that does not say
-- what it has, behaves exactly as before.

alter table exercises add column equipment text[] not null default '{}';

update exercises set equipment = e.equipment
from (values
  ('Back Squat',                       array['barbell','rack']),
  ('Leg Press',                        array['machine']),
  ('Hack Squat',                       array['machine']),
  ('Smith Machine Squat',              array['machine']),
  ('Goblet Squat',                     array['dumbbell']),
  ('Bulgarian Split Squat',            array['dumbbell']),
  ('Romanian Deadlift',                array['barbell']),
  ('Hip Thrust',                       array['barbell','bench']),
  ('Back Extension',                   array['machine']),
  ('Chest Press Machine',              array['machine']),
  ('Incline Dumbbell Press',           array['dumbbell','bench']),
  ('Flat Dumbbell Bench Press',        array['dumbbell','bench']),
  ('Barbell Bench Press',              array['barbell','bench','rack']),
  ('Overhead Press',                   array['barbell','rack']),
  ('Seated Dumbbell Shoulder Press',   array['dumbbell','bench']),
  ('Machine Shoulder Press',           array['machine']),
  ('Seated Cable Row',                 array['cable']),
  ('Chest-Supported Row',              array['machine']),
  ('Barbell Row',                      array['barbell']),
  ('Single-Arm Dumbbell Row',          array['dumbbell','bench']),
  ('Lat Pulldown',                     array['cable']),
  ('Pull-up',                          array['pullup_bar']),
  ('Assisted Pull-up',                 array['machine']),
  ('Seated Leg Curl',                  array['machine']),
  ('Leg Extension',                    array['machine']),
  ('Lateral Raise',                    array['dumbbell']),
  ('Cable Lateral Raise',              array['cable']),
  ('Face Pull',                        array['cable']),
  ('Rear Delt Fly',                    array['dumbbell']),
  ('Dumbbell Biceps Curl',             array['dumbbell']),
  ('Barbell Curl',                     array['barbell']),
  ('Cable Triceps Pushdown',           array['cable']),
  ('Overhead Cable Triceps Extension', array['cable']),
  ('Cable Fly',                        array['cable']),
  ('Pec Deck',                         array['machine'])
) as e(name, equipment)
where exercises.name = e.name;

-- Movements for the places that are not a commercial gym: a hotel room, a
-- parents' basement, a week away with a pair of dumbbells. Chosen so that
-- every movement pattern has something that needs nothing.
insert into exercises (name, pattern, equipment) values
  ('Bodyweight Squat',        'squat',  array['bodyweight']),
  ('Walking Lunge',           'squat',  array['bodyweight']),
  ('Dumbbell Squat',          'squat',  array['dumbbell']),
  ('Step-up',                 'squat',  array['dumbbell']),
  ('Glute Bridge',            'hinge',  array['bodyweight']),
  ('Dumbbell Romanian Deadlift', 'hinge', array['dumbbell']),
  ('Nordic Curl',             'hinge',  array['bodyweight']),
  ('Push-up',                 'h_push', array['bodyweight']),
  ('Incline Push-up',         'h_push', array['bodyweight']),
  ('Dumbbell Floor Press',    'h_push', array['dumbbell']),
  ('Pike Push-up',            'v_push', array['bodyweight']),
  ('Inverted Row',            'h_pull', array['bodyweight']),
  ('Chin-up',                 'v_pull', array['pullup_bar']),
  ('Band Pull-apart',         'iso',    array['bands']),
  ('Dumbbell Hammer Curl',    'iso',    array['dumbbell']),
  ('Dumbbell Skull Crusher',  'iso',    array['dumbbell','bench']),
  ('Bench Dip',               'iso',    array['bodyweight','bench'])
on conflict (name) do nothing;

-- Substitutes for the new movements, and the fallbacks that make a hotel gym
-- work: every heavy compound now has something that needs nothing after it.
with pairs(exercise, substitute, rank) as (values
  ('Bodyweight Squat',            'Walking Lunge',              1),
  ('Bodyweight Squat',            'Dumbbell Squat',             2),
  ('Walking Lunge',               'Bulgarian Split Squat',      1),
  ('Walking Lunge',               'Bodyweight Squat',           2),
  ('Dumbbell Squat',              'Goblet Squat',               1),
  ('Dumbbell Squat',              'Walking Lunge',              2),
  ('Step-up',                     'Bulgarian Split Squat',      1),
  ('Step-up',                     'Walking Lunge',              2),
  ('Glute Bridge',                'Hip Thrust',                 1),
  ('Glute Bridge',                'Dumbbell Romanian Deadlift', 2),
  ('Dumbbell Romanian Deadlift',  'Romanian Deadlift',          1),
  ('Dumbbell Romanian Deadlift',  'Glute Bridge',               2),
  ('Nordic Curl',                 'Seated Leg Curl',            1),
  ('Push-up',                     'Incline Push-up',            1),
  ('Push-up',                     'Dumbbell Floor Press',       2),
  ('Incline Push-up',             'Push-up',                    1),
  ('Dumbbell Floor Press',        'Flat Dumbbell Bench Press',  1),
  ('Dumbbell Floor Press',        'Push-up',                    2),
  ('Pike Push-up',                'Seated Dumbbell Shoulder Press', 1),
  ('Inverted Row',                'Single-Arm Dumbbell Row',    1),
  ('Inverted Row',                'Seated Cable Row',           2),
  ('Chin-up',                     'Pull-up',                    1),
  ('Chin-up',                     'Lat Pulldown',               2),
  ('Band Pull-apart',             'Face Pull',                  1),
  ('Dumbbell Hammer Curl',        'Dumbbell Biceps Curl',       1),
  ('Dumbbell Skull Crusher',      'Cable Triceps Pushdown',     1),
  ('Bench Dip',                   'Cable Triceps Pushdown',     1)
)
update exercises e
set substitutes = sub.ids
from (
  select p.exercise, array_agg(s.id order by p.rank) as ids
  from pairs p join exercises s on s.name = p.substitute
  group by p.exercise
) sub
where e.name = sub.exercise;

-- And append the equipment-free fallbacks to what the gym movements already
-- offer, so a swap in a hotel room lands on something that exists.
with extra(exercise, substitute) as (values
  ('Back Squat',                'Dumbbell Squat'),
  ('Back Squat',                'Walking Lunge'),
  ('Leg Press',                 'Walking Lunge'),
  ('Hack Squat',                'Dumbbell Squat'),
  ('Bulgarian Split Squat',     'Walking Lunge'),
  ('Romanian Deadlift',         'Dumbbell Romanian Deadlift'),
  ('Hip Thrust',                'Glute Bridge'),
  ('Chest Press Machine',       'Push-up'),
  ('Barbell Bench Press',       'Dumbbell Floor Press'),
  ('Incline Dumbbell Press',    'Incline Push-up'),
  ('Overhead Press',            'Pike Push-up'),
  ('Machine Shoulder Press',    'Pike Push-up'),
  ('Seated Cable Row',          'Inverted Row'),
  ('Chest-Supported Row',       'Inverted Row'),
  ('Lat Pulldown',              'Chin-up'),
  ('Pull-up',                   'Chin-up'),
  ('Seated Leg Curl',           'Nordic Curl'),
  ('Face Pull',                 'Band Pull-apart'),
  ('Cable Triceps Pushdown',    'Bench Dip'),
  ('Dumbbell Biceps Curl',      'Dumbbell Hammer Curl')
)
update exercises e
set substitutes = e.substitutes || sub.ids
from (
  select x.exercise, array_agg(s.id) as ids
  from extra x join exercises s on s.name = x.substitute
  group by x.exercise
) sub
where e.name = sub.exercise
  and not (sub.ids <@ e.substitutes);
