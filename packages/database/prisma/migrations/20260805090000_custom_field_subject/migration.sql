CREATE TYPE "CustomFieldSubject" AS ENUM ('STUDENT', 'GUARDIAN');

ALTER TABLE "custom_field"
  ADD COLUMN "subject" "CustomFieldSubject" NOT NULL DEFAULT 'STUDENT';

CREATE TABLE "guardian_field_value" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "guardianId" UUID NOT NULL,
  "fieldId" UUID NOT NULL,
  "value" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "guardian_field_value_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guardian_field_value_organizationId_guardianId_fieldId_key" UNIQUE ("organizationId", "guardianId", "fieldId")
);

CREATE INDEX "guardian_field_value_organizationId_fieldId_idx"
  ON "guardian_field_value"("organizationId", "fieldId");

ALTER TABLE "guardian_field_value"
  ADD CONSTRAINT "guardian_field_value_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guardian_field_value"
  ADD CONSTRAINT "guardian_field_value_organizationId_guardianId_fkey"
  FOREIGN KEY ("organizationId", "guardianId") REFERENCES "guardian"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guardian_field_value"
  ADD CONSTRAINT "guardian_field_value_organizationId_fieldId_fkey"
  FOREIGN KEY ("organizationId", "fieldId") REFERENCES "custom_field"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
