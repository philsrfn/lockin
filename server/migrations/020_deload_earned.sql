-- What earned the light week.
--
-- The counter resets the moment a deload is recorded, so the message explaining
-- it was computed from a count that had just gone to zero: "you have trained 0
-- weeks straight and this is what keeps that going". The block that earned it
-- is a fact about the deload, so it is stored on the deload.
alter table deloads add column training_weeks int;
