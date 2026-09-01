-- Barcode lookup. Additive: a nullable column and an index, nothing rewritten.
--
-- §11 names OpenFoodFacts as the source — free, and decent German coverage,
-- which matters because most of what he scans will be from a German shop.
-- Products are cached into his own library on first scan, so the second scan of
-- the same tub of Skyr needs no network at all.

alter table foods add column barcode text;

create unique index foods_barcode_key on foods (barcode) where barcode is not null;
