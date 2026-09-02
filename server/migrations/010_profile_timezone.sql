-- Where the athlete actually is.
--
-- "Today" was decided two ways at once: Node reading a container pinned to
-- TZ=Europe/Berlin, and Postgres `current_date` reading its session timezone.
-- Both happen to be right for one man in Münster. Neither is right for anyone
-- else — the day would roll over mid-afternoon, the 07:30 check-in would fire
-- at 01:30, and a meal logged after dinner would land on tomorrow.
--
-- Additive, with the default that reproduces today's behaviour exactly.
alter table profile add column timezone text not null default 'Europe/Berlin';
