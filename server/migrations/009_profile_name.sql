-- His name. Additive, and data rather than a string literal in the app: it is
-- his profile, and the one place the interface speaks to him directly should
-- come from the same row as his height and his targets.
alter table profile add column name text;

update profile set name = 'Phil' where id = 1;
