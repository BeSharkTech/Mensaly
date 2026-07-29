ALTER TABLE "reminder_rule"
  ADD COLUMN "templateId" UUID;

ALTER TABLE "message_schedule"
  ADD COLUMN "automationKey" VARCHAR(80),
  ADD COLUMN "queuedAt" TIMESTAMPTZ(3),
  ADD COLUMN "enqueuedFor" TIMESTAMPTZ(3);

CREATE INDEX "reminder_rule_organizationId_templateId_idx"
  ON "reminder_rule"("organizationId", "templateId");

CREATE UNIQUE INDEX "message_schedule_organizationId_chargeId_automationKey_key"
  ON "message_schedule"("organizationId", "chargeId", "automationKey");

ALTER TABLE "reminder_rule"
  ADD CONSTRAINT "reminder_rule_organizationId_templateId_fkey"
  FOREIGN KEY ("organizationId", "templateId")
  REFERENCES "message_template"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
