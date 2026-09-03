-- When the athlete last opened the app.
--
-- The morning check-in generates a fresh coaching note for every athlete every
-- day, whether or not they ever open it — so somebody who installed the app,
-- used it for a week and drifted off keeps costing a model call every morning,
-- forever, for a notification they no longer read. Ten friends: invisible. A
-- hundred casual signups: most of the bill.
--
-- Backfilled to now so nobody who is already here is treated as gone.
alter table profile add column last_seen_at timestamptz;

update profile set last_seen_at = now();
