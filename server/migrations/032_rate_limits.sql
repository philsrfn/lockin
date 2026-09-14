-- Rate limit counters that survive a second process.
--
-- The limiter has always been a Map in one process, and the file said plainly
-- that this is the thing to change when there is a second one. Going public is
-- what makes a second one likely, and the failure is silent: two workers each
-- keep their own counters, so a limit of forty an hour quietly becomes eighty,
-- and nobody finds out until a bill does.
--
-- Not every limit needs this. The per-request `api` ceiling protects one
-- process from a runaway phone, and a second process brings its own capacity
-- along with its own counter — per-process is the right shape there, and it
-- costs no query. What has to be shared is what guards something finite:
-- model spend, and the sign-in door. Those are the two that live here.
--
-- No `user_id`: a key is an athlete id on an authenticated path and an address
-- on the sign-in one, and an address belongs to nobody. That is also why this
-- table gets no tenant policy — 028 derives those from the presence of a
-- user_id column, and correctly finds none here.

create table if not exists rate_limits (
  key      text primary key,
  count    integer not null,
  reset_at timestamptz not null
);

-- The sweep deletes by expiry, and is the only query that does not go straight
-- to the primary key.
create index if not exists rate_limits_reset_at_idx on rate_limits (reset_at);

-- 028 set default privileges for this role, so this is belt and braces rather
-- than load-bearing — but a limiter that cannot write is a limiter that fails
-- every request, and that is not a thing to leave to an inherited setting.
grant select, insert, update, delete on rate_limits to lockin_app;
