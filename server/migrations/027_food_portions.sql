-- A food row has never said what its numbers mean.
--
-- `foods` was built on one assumption, stated in migration 005: "one tap logs
-- the whole thing, no arithmetic, no portion picker". Every row is a portion.
--
-- Then barcodes arrived. saveScanned() writes the per-100g figures from
-- OpenFoodFacts straight into the same columns, deliberately — so the next
-- scan can be scaled to a different portion instead of inheriting the last
-- one. Sound reasoning, and it left the table meaning two different things
-- depending on whether `barcode` is null, with nothing anywhere saying so.
--
-- Both readers then got it wrong, silently and in the same direction:
--
--   Scanning a product a second time returned it as "known", which the app
--   read as "already a portion" — so it hid the grams field and logged 100g
--   of it, whatever had actually been eaten.
--
--   A scanned food also appears in the library, where one tap on the tile
--   posts /meals/from-food, which logs the row's raw numbers. Same 100g,
--   different door.
--
-- Neither failed loudly. They wrote a plausible number into the log that the
-- whole app then steers on — remaining protein, the deficit, the weekly
-- review. So the basis stops being implied.

-- null = the row is one portion, log it as it stands (the original meaning,
-- and still the right one for a tub of Skyr or a shake).
-- 100  = the numbers describe 100 grams and a portion has to be given.
alter table foods add column per_grams int
  check (per_grams is null or per_grams > 0);

-- Every barcode row was written per 100g by saveScanned. Nothing else has
-- ever set a basis, so nothing else changes meaning.
update foods set per_grams = 100 where barcode is not null;

-- What was eaten last time, so the second scan offers that instead of a
-- number nobody chose. Null until they weigh something once.
alter table foods add column last_grams int
  check (last_grams is null or last_grams > 0);
