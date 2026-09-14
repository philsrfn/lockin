-- Cardio moves the day's calorie target, if the athlete wants it to.
--
-- The complaint that prompted this: cardio has no effect. Which was true —
-- `domain/targets.ts` folds training into maintenance as a flat
-- `trainingDaysPerWeek × 350 / 7`, smeared across every day, so a Tuesday run
-- and a Wednesday rest day produce the same number to eat. The calories were
-- there; the day they happened on was not.
--
-- A setting rather than behaviour, because it is a preference and people
-- differ on it: some want the number to hold still so that a hard day is not
-- also a bigger dinner. Off by default, so nobody's target moves because of a
-- deploy — what they see tomorrow is what they saw yesterday until they ask
-- for something else.

alter table profile
  add column cardio_adds_calories boolean not null default false;

comment on column profile.cardio_adds_calories is
  'When on, today''s logged cardio raises today''s calorie target. See domain/cardioBurn.ts for what it is worth and why it is less than the session burned.';
