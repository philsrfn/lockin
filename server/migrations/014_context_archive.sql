-- Places come and go: a gym membership lapses, a city stops being somewhere you
-- visit. Archived rather than deleted, like foods — sessions carry the context
-- they were performed in, and deleting one would either fail on the reference
-- or quietly rewrite where he trained.
alter table contexts add column archived boolean not null default false;

-- The unique index has to let an archived name be reused, the same way an
-- archived food frees its name.
drop index contexts_name_key;
create unique index contexts_name_key on contexts (user_id, name) where not archived;
