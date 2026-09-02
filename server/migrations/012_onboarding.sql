-- What the app needs to know about a body before it can set targets for it.
--
-- Phil's numbers were typed into a seed migration: there was one athlete and he
-- already knew them. Anyone else arrives with a height and a goal, and the
-- targets have to be computed — Mifflin-St Jeor and an activity factor, in
-- code, per §1. That needs sex, age and a stated goal, none of which the
-- profile held.
--
-- Additive and all nullable. Every existing profile is marked onboarded so
-- nobody is sent back through a questionnaire for data they already have; the
-- safety floors fall back to their absolute values while sex and age are
-- unknown, which is exactly the behaviour Phil has today.

alter table profile add column sex text
  check (sex in ('male', 'female'));

alter table profile add column activity_level text
  check (activity_level in ('sedentary', 'light', 'moderate', 'active'));

alter table profile add column goal text
  check (goal in ('lose', 'maintain', 'gain'));

alter table profile add column training_days_per_week int
  check (training_days_per_week between 0 and 7);

-- The rate the targets were sized from, after clamping. Negative is loss.
alter table profile add column weekly_rate_kg numeric;

alter table profile add column onboarded_at timestamptz;

update profile set onboarded_at = now();
