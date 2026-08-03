ALTER TABLE "stripe_checkout"
  ADD COLUMN "providerSessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerSessionLeaseUntil" TIMESTAMPTZ(3);

ALTER TABLE "stripe_checkout"
  ALTER COLUMN "status" SET DEFAULT 'OPEN';
