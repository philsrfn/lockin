-- Sign in with Apple.
--
-- Handing somebody a token by hand is fine for three friends and absurd for
-- thirty, and the App Store requires Apple sign-in wherever another social
-- login exists. The scheme underneath does not change: a session is still a
-- long-lived token matched by its hash. Apple only decides which row it
-- resolves to.
--
-- `sub` is Apple's stable identifier for this person in this app. It is the
-- only thing Apple guarantees will not change — the email can be a private
-- relay address, can be hidden, and is only ever sent on the very first
-- authorisation, which is why it cannot be the key.
alter table users add column apple_sub text;

create unique index users_apple_sub_key on users (apple_sub) where apple_sub is not null;

-- Tokens become per-device rather than one per person, so signing in on an
-- iPad does not sign you out of your phone, and losing one device does not
-- mean rotating everywhere.
create table sessions_tokens (
  id          serial primary key,
  user_id     int not null references users(id) on delete cascade,
  token_hash  text not null unique,
  -- What issued it: 'apple', or 'manual' for one handed over by the CLI.
  source      text not null default 'apple',
  device      text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index sessions_tokens_user_idx on sessions_tokens (user_id);

-- Everything already issued keeps working: users.token_hash stays the source of
-- truth for the token in Phil's keychain and the ones the CLI prints.
