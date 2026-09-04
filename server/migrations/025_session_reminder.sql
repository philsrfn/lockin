-- The fifth §8 trigger, which was never built.
--
-- §8 asks for it "30 min before planned session". There is no planned session
-- time in this model and there never was: §5 makes the targets weekly on
-- purpose — "not fixed weekdays, travel makes fixed days fail" — so no row
-- anywhere says when today's session is meant to start. Rather than invent a
-- schedule the app does not have, this fires at a time of day like every other
-- job, and the handler decides whether there is anything worth saying.
--
-- 17:00 local: late enough that somebody who trains in the morning has already
-- done it and will be skipped, early enough to still act on.
insert into job_schedule (user_id, job, hour, minute, day_of_week)
select id, 'session_reminder', 17, 0, null from users
on conflict (user_id, job) do nothing;
