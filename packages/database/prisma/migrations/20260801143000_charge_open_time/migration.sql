-- The default preserves the previous behavior: charges open at the start of
-- the configured local calendar day until a school chooses a different time.
ALTER TABLE "plan"
  ADD COLUMN "chargeOpenTime" VARCHAR(5) NOT NULL DEFAULT '00:00';

ALTER TABLE "enrollment"
  ADD COLUMN "chargeOpenTime" VARCHAR(5) NOT NULL DEFAULT '00:00';
