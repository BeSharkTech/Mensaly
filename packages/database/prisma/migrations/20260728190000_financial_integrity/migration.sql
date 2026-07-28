ALTER TABLE "payment"
  ADD COLUMN "idempotencyKey" VARCHAR(128);

UPDATE "payment"
SET "idempotencyKey" = 'legacy:' || "id"::text
WHERE "idempotencyKey" IS NULL;

ALTER TABLE "payment"
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  ADD CONSTRAINT "payment_idempotency_key_length"
    CHECK (char_length("idempotencyKey") BETWEEN 8 AND 128);

ALTER TABLE "charge"
  DROP CONSTRAINT "charge_enrollmentId_fkey";

ALTER TABLE "payment"
  DROP CONSTRAINT "payment_chargeId_fkey";

CREATE UNIQUE INDEX "enrollment_organizationId_id_key"
  ON "enrollment"("organizationId", "id");

CREATE UNIQUE INDEX "charge_organizationId_id_key"
  ON "charge"("organizationId", "id");

CREATE UNIQUE INDEX "payment_organizationId_idempotencyKey_key"
  ON "payment"("organizationId", "idempotencyKey");

CREATE UNIQUE INDEX "payment_one_active_per_charge_key"
  ON "payment"("chargeId")
  WHERE "status" IN ('PENDING_RECONCILIATION', 'CONFIRMED');

ALTER TABLE "charge"
  ADD CONSTRAINT "charge_organizationId_enrollmentId_fkey"
  FOREIGN KEY ("organizationId", "enrollmentId")
  REFERENCES "enrollment"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "payment"
  ADD CONSTRAINT "payment_organizationId_chargeId_fkey"
  FOREIGN KEY ("organizationId", "chargeId")
  REFERENCES "charge"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
