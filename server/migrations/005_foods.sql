-- Phase 4: the food library.
--
-- Strictly additive. The app is in daily use as of 2026-09-01 and there is real
-- training data in here — nothing existing is dropped, renamed or rewritten.
--
-- §11: "Do not build or integrate a general nutrition database. ~90% of intake
-- is ~25 foods." So this is *his* library, and it grows by use rather than by
-- seeding. The three quick-add tiles below are the composites the spec names;
-- everything else arrives because he typed it once.

create table foods (
  id            serial primary key,
  name          text not null,
  kcal          int not null,
  protein_g     int not null,
  fat_g         int,
  carbs_g       int,
  -- Quick-add tiles sit at the top of the food screen. One tap logs the whole
  -- thing, no arithmetic, no portion picker.
  quick_add     boolean not null default false,
  -- Which meal it usually is, so a tap can fill the slot too. null = any.
  default_slot  text check (default_slot in ('breakfast','lunch','dinner','snack')),
  times_used    int not null default 0,
  last_used_at  timestamptz,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create unique index foods_name_key on foods (lower(name)) where not archived;
create index foods_recent_idx on foods (last_used_at desc nulls last);

-- meals gains fat and carbs. Nullable, so every row already written stays valid
-- and the running fat-floor number stops being guesswork.
alter table meals add column fat_g int;
alter table meals add column carbs_g int;

-- Which library entry produced this meal, when one did. Nullable: a meal logged
-- from chat or typed by hand has no library row behind it.
alter table meals add column food_id int references foods(id) on delete set null;

create index meals_food_id_idx on meals (food_id);

-- The staples §11 names as quick-add tiles, with the macros the spec implies.
-- Estimates he can correct in the app; being roughly right beats being absent.
insert into foods (name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot) values
  ('Skyr breakfast (500g Skyr, berries, 40g oats)', 520, 55, 6, 62, true, 'breakfast'),
  ('Mom''s dinner (half) + 200g Magerquark',        600, 45, 18, 55, true, 'dinner'),
  ('Soy chunk bowl',                                620, 52, 14, 65, true, 'lunch');
