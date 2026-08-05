ALTER TABLE "student" ADD COLUMN "rg" VARCHAR(20);

CREATE UNIQUE INDEX "student_organizationId_rg_key"
  ON "student"("organizationId", "rg");

CREATE TABLE "public_enrollment_form" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "nonce" VARCHAR(64) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "fieldConfiguration" JSONB NOT NULL,
  "privacyNoticeVersion" VARCHAR(40) NOT NULL DEFAULT '2026-08-01',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "public_enrollment_form_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_enrollment_form_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "public_enrollment_form_organizationId_key"
  ON "public_enrollment_form"("organizationId");
CREATE UNIQUE INDEX "public_enrollment_form_organizationId_id_key"
  ON "public_enrollment_form"("organizationId", "id");
CREATE INDEX "public_enrollment_form_active_updatedAt_idx"
  ON "public_enrollment_form"("active", "updatedAt");

CREATE TABLE "public_enrollment_submission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "formId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "guardianId" UUID NOT NULL,
  "enrollmentId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "consentVersion" VARCHAR(40) NOT NULL,
  "consentedAt" TIMESTAMPTZ(3) NOT NULL,
  "ipHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_enrollment_submission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "public_enrollment_submission_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "public_enrollment_submission_form_fkey"
    FOREIGN KEY ("organizationId", "formId") REFERENCES "public_enrollment_form"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "public_enrollment_submission_student_fkey"
    FOREIGN KEY ("organizationId", "studentId") REFERENCES "student"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "public_enrollment_submission_guardian_fkey"
    FOREIGN KEY ("organizationId", "guardianId") REFERENCES "guardian"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "public_enrollment_submission_enrollment_fkey"
    FOREIGN KEY ("organizationId", "enrollmentId") REFERENCES "enrollment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "public_enrollment_submission_enrollmentId_key"
  ON "public_enrollment_submission"("enrollmentId");
CREATE UNIQUE INDEX "public_enrollment_submission_formId_idempotencyKey_key"
  ON "public_enrollment_submission"("formId", "idempotencyKey");
CREATE UNIQUE INDEX "public_enrollment_submission_organizationId_enrollmentId_key"
  ON "public_enrollment_submission"("organizationId", "enrollmentId");
CREATE INDEX "public_enrollment_submission_organizationId_createdAt_idx"
  ON "public_enrollment_submission"("organizationId", "createdAt");
CREATE INDEX "public_enrollment_submission_studentId_createdAt_idx"
  ON "public_enrollment_submission"("studentId", "createdAt");
