CREATE INDEX "charge_organizationId_referenceMonth_status_idx"
ON "charge"("organizationId", "referenceMonth", "status");
