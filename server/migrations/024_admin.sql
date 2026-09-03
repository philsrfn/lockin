-- An admin panel: who is using this, and what are they costing.
--
-- Three separate things, all additive.

-- 1. Which model spent the tokens.
--
-- The provider has always returned the model string that answered and the
-- meter has always dropped it, so spend could be counted but not priced —
-- Flash and Pro differ by 4x on input and 4x on output. Existing rows keep an
-- empty model and are reported as unpriced rather than being back-dated to a
-- rate they may not have been billed at.
alter table llm_usage add column model text not null default '';

-- The grain gains a column: one athlete can hit Flash and Pro on the same day
-- for the same purpose, and those are two rates.
alter table llm_usage drop constraint llm_usage_pkey;
alter table llm_usage add primary key (user_id, day, purpose, model);

-- 2. Who may look at the panel.
--
-- Not "whoever holds a token on users.token_hash" — the CLI hands those to
-- friends, and a friend is not an operator. An explicit flag, granted in the
-- database and nowhere else. There is no route that sets it.
alter table users add column is_admin boolean not null default false;
update users set is_admin = true where id = 1;

-- 3. Who may use the app at all.
--
-- Sign in with Apple means anybody who has the TestFlight link can create an
-- account, and every account costs money the moment it talks to the trainer.
-- So an account starts pending and an admin lets it in.
--
-- Null is pending. Everyone who already exists is approved as of now: they
-- were let in by hand, which is what this column records.
alter table users add column approved_at timestamptz;
update users set approved_at = now();

-- 4. What an admin did, and when.
--
-- Approving and revoking are the two actions on this panel that change what
-- somebody else can do. Six months on, "when did I let Sam in" and "why is
-- this account revoked" are questions the row itself cannot answer.
create table admin_actions (
  id         bigserial primary key,
  actor_id   int not null references users(id) on delete cascade,
  subject_id int references users(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index admin_actions_recent_idx on admin_actions (created_at desc);
