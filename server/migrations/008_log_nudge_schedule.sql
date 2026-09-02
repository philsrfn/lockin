-- The log nudge is not a time of day: it fires when a session has been open 90
-- minutes with nothing in it. Scheduled from 00:00 so it is always "due", and
-- the handler returns retry:true whenever there is nothing to nudge about, so
-- the day is not claimed until it actually sends.
insert into job_schedule (job, hour, minute, day_of_week) values ('log_nudge', 0, 0, null)
on conflict (job) do nothing;
