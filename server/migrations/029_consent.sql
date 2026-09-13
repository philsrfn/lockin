-- Consent, recorded rather than assumed.
--
-- Training history, body weight and everything Apple Health sends are Article
-- 9 data under the GDPR — a special category, alongside biometrics and medical
-- records. Processing it needs explicit consent, and "explicit" means the
-- person was shown what they were agreeing to and said yes to that, not that
-- a policy existed somewhere and using the app implied it.
--
-- So the version is part of the row. A privacy notice that changes is a
-- different thing to have agreed to, and the only honest way to know who has
-- agreed to the current one is to have stored which one they saw.
--
-- Withdrawal is a right, not a feature request, and it has to be as easy as
-- giving it. `withdrawn_at` rather than deleting the row: erasing the record
-- of a consent erases the evidence that it was ever lawfully collected, which
-- is the opposite of what the obligation asks for.

create table consents (
  user_id      int not null references users(id) on delete cascade,
  -- What was agreed to. A date rather than a number so it reads as what it is
  -- when somebody has to answer "which notice was that".
  document     text not null,
  version      text not null,
  agreed_at    timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- Kept because an authority asking "how was this obtained" is asking about
  -- the circumstances, not only the fact.
  locale       text,
  primary key (user_id, document, version)
);

create index consents_user_idx on consents (user_id, agreed_at desc);

-- Same protection as every other table holding somebody's data. Migration 028
-- put the policy behind a function precisely so this is one line — and
-- `src/__tests__/rls.int.test.ts` fails if a later migration forgets it, which
-- is how this line came to be here.
select apply_tenant_policy('consents');
