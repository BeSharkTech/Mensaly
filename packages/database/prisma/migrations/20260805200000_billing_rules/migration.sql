CREATE TYPE "BillingRuleSourceType" AS ENUM ('PLAN', 'PRODUCT', 'EVENT');
CREATE TYPE "BillingRuleFrequency" AS ENUM ('MONTHLY', 'ONCE');
CREATE TYPE "BillingRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ENDED');

ALTER TABLE "charge" ADD COLUMN "billingRuleId" UUID;
ALTER TABLE "charge" ADD COLUMN "cycleKey" VARCHAR(160);

UPDATE "charge"
SET "cycleKey" = 'legacy:' || to_char("referenceMonth", 'YYYY-MM');

ALTER TABLE "charge" ALTER COLUMN "cycleKey" SET NOT NULL;
ALTER TABLE "charge" ALTER COLUMN "cycleKey" SET DEFAULT '';
DROP INDEX "charge_organizationId_enrollmentId_referenceMonth_key";
CREATE UNIQUE INDEX "charge_organizationId_enrollmentId_cycleKey_key"
  ON "charge"("organizationId", "enrollmentId", "cycleKey");

CREATE TABLE "billing_rule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "sourceType" "BillingRuleSourceType" NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceNameSnapshot" VARCHAR(120) NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "frequency" "BillingRuleFrequency" NOT NULL,
  "opensOn" DATE NOT NULL,
  "expiresOn" DATE NOT NULL,
  "repeatUntil" DATE,
  "status" "BillingRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "billing_rule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_rule_target" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "billingRuleId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_rule_target_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_rule_organizationId_id_key" ON "billing_rule"("organizationId", "id");
CREATE INDEX "billing_rule_organizationId_status_opensOn_idx" ON "billing_rule"("organizationId", "status", "opensOn");
CREATE UNIQUE INDEX "billing_rule_target_organizationId_billingRuleId_studentId_key" ON "billing_rule_target"("organizationId", "billingRuleId", "studentId");
CREATE INDEX "billing_rule_target_organizationId_studentId_idx" ON "billing_rule_target"("organizationId", "studentId");

ALTER TABLE "billing_rule" ADD CONSTRAINT "billing_rule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_rule_target" ADD CONSTRAINT "billing_rule_target_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_rule_target" ADD CONSTRAINT "billing_rule_target_organizationId_billingRuleId_fkey"
  FOREIGN KEY ("organizationId", "billingRuleId") REFERENCES "billing_rule"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_rule_target" ADD CONSTRAINT "billing_rule_target_organizationId_studentId_fkey"
  FOREIGN KEY ("organizationId", "studentId") REFERENCES "student"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "charge" ADD CONSTRAINT "charge_organizationId_billingRuleId_fkey"
  FOREIGN KEY ("organizationId", "billingRuleId") REFERENCES "billing_rule"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
