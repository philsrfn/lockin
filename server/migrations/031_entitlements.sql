-- Who may use the trainer.
--
-- The app costs about two cents a month per athlete to run and rather more
-- than that to build, so at some point it has to ask for money. This is the
-- half of that which can exist before there is anything to buy: what an
-- account is entitled to, and until when. Apple's receipt verification sets
-- this row later; an operator can set it today.
--
-- ONE ROW, NOT A LEDGER
--
-- What matters at request time is "may this person talk to the trainer right
-- now", which is one question with one answer. A subscription's history — who
-- granted it, when, why — belongs in `admin_actions`, which already exists and
-- already records operator decisions. Two tables pretending to be one
-- authority is how an entitlement ends up disagreeing with itself.
--
-- NOBODY IS CUT OFF BY A DEPLOY
--
-- Every account that exists when this runs is comped, with no expiry. They
-- signed up to something that did not ask for money, and changing that is a
-- conversation rather than a migration. New accounts get a trial from
-- `TRIAL_DAYS`.

create table entitlements (
  user_id    int primary key references users(id) on delete cascade,
  -- trial: time-limited, granted at signup.
  -- paid: an App Store subscription, or money that arrived some other way.
  -- comped: on the house, and the only kind allowed to have no expiry.
  kind       text not null check (kind in ('trial', 'paid', 'comped')),
  -- Null means never expires, which only makes sense for comped.
  expires_at timestamptz,
  -- Where the right came from, so "why can this person use it" has an answer.
  source     text not null check (source in ('signup', 'apple', 'operator')),
  updated_at timestamptz not null default now(),
  check (expires_at is not null or kind = 'comped')
);

create index entitlements_expiry_idx on entitlements (expires_at)
  where expires_at is not null;

-- Everybody already here keeps what they had.
insert into entitlements (user_id, kind, expires_at, source)
select id, 'comped', null, 'operator' from users
on conflict (user_id) do nothing;

select apply_tenant_policy('entitlements');
