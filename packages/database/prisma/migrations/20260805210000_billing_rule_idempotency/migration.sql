ALTER TABLE "billing_rule" ADD COLUMN "idempotencyKey" VARCHAR(128);
UPDATE "billing_rule" SET "idempotencyKey" = 'legacy:' || "id"::text;
ALTER TABLE "billing_rule" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "billing_rule_organizationId_idempotencyKey_key"
  ON "billing_rule"("organizationId", "idempotencyKey");
