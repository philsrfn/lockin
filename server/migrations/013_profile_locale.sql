-- The language the athlete reads.
--
-- The greeting and the masthead date were German literals, which is the sort
-- of thing that makes an app feel like somebody else's — a friend in Boston
-- opening it to "Guten Abend" is being shown around a house rather than handed
-- the keys.
--
-- Device detection alone is not enough: it tells you what the phone is set to,
-- not what the person wants the coach to speak, and a German athlete with an
-- English phone should still get German. So the choice lives on the profile,
-- and the device is only the default it is seeded from.
--
-- Nullable, and every existing row is German, because every existing row is
-- his.
alter table profile add column locale text;

update profile set locale = 'de';
