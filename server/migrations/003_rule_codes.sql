-- Rules are free text so they read like Phil wrote them, and so he can edit
-- them in the app. But a validator cannot interpret arbitrary prose, so the
-- rules that are mechanically checkable carry a stable code that maps to a
-- checker function in server/src/rules/checks.ts.
--
-- A rule with no code still reaches the model in the system instruction; it
-- just cannot be enforced by the validator. That distinction is deliberate and
-- surfaced in the app.

alter table rules add column code text;

create unique index rules_code_key on rules (code) where code is not null;

update rules set code = 'breakfast_skyr'
  where text like 'Breakfast is always%';

update rules set code = 'home_dinner_moms_food'
  where text like 'When context is Home, dinner is half a portion%';

update rules set code = 'min_daily_protein'
  where text like 'Never propose a day under 160g protein%';

update rules set code = 'no_intervals_on_football_day'
  where text like 'Never schedule hard intervals on a football day%';

update rules set code = 'prefer_soy_chunks'
  where text like 'Prefer soy chunks%';

update rules set code = 'prefer_treadmill'
  where text like 'Prefer treadmill%';

update rules set code = 'weekly_targets_not_weekdays'
  where text like 'Weekly movement targets%';
