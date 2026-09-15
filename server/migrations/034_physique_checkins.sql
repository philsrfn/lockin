-- The weekly photo, without the photo.
--
-- The scale answers "how much", the tape answers "where", and neither answers
-- the question somebody actually asks in front of a mirror: does this look
-- different than it did a month ago. A photograph answers it and nothing else
-- does — which is why this exists, and why it was the hardest thing in the app
-- to let in.
--
-- WHAT IS NOT HERE
--
-- The image. Not a file, not a column, not a bucket, not a path. The privacy
-- notice has always said photographs are not stored, and a body photograph is
-- the one where that promise matters most. The picture lives in the app's own
-- sandbox on the phone; it goes to the model once per check-in, together with
-- the handful of earlier ones the comparison needs, and is gone from this
-- process the moment the answer comes back.
--
-- The cost of that is real and was chosen knowingly: a new phone starts with
-- an empty album, and the data export carries the words but not the pictures.
-- The alternative is holding somebody's body on a rented droplet, which is a
-- promise this app is not in a position to keep.
--
-- WHAT IS HERE, AND WHY IT IS PROSE
--
-- No estimated body fat percentage, and no number of any kind. §1 keeps every
-- number that matters out of the model, and a percentage guessed from a
-- photograph is the worst case of exactly that: it is not a measurement, it
-- changes with the bathroom light, and it would sit next to a weight from a
-- scale and a waist from a tape measure looking just as solid as they are.
-- What the model is good at is noticing that something changed, and saying so.
-- The numbers stay where they were measured.
--
-- ONE ROW A WEEK
--
-- Keyed on the day, so a second photograph on the same Sunday replaces
-- nothing and inserts nothing — the check-in already happened. `taken_on` is
-- the athlete's own day, decided by `services/clock.ts`, never the server's.

create table physique_checkins (
  id          serial primary key,
  user_id     int not null references users(id) on delete cascade,
  taken_on    date not null,
  -- How many photographs went into it, this week's included. A comparison
  -- drawn from one picture is a description, and the screen says so rather
  -- than dressing it up as a trend.
  photo_count int not null check (photo_count between 1 and 4),
  -- One line, read on a lock screen.
  headline    text not null,
  assessment  text not null,
  -- What changed against the earlier photographs. Null on the first check-in,
  -- because there is nothing to compare against and inventing a change is how
  -- a trainer stops being believed.
  change      text,
  created_at  timestamptz not null default now(),
  unique (user_id, taken_on)
);

create index physique_checkins_recent_idx on physique_checkins (user_id, taken_on desc);

select apply_tenant_policy('physique_checkins');

-- The sixth job. Sunday morning rather than Sunday evening beside the weekly
-- review: a photograph taken before breakfast, in the same light, at the same
-- hour, is the only kind worth comparing to last week's. The review at 18:00
-- reads the week's numbers; this one asks for the picture while the conditions
-- are still repeatable.
--
-- Additive for everybody who already exists, like 025 before it.
insert into job_schedule (user_id, job, hour, minute, day_of_week)
select id, 'physique_checkin', 9, 0, 0 from users
on conflict (user_id, job) do nothing;
