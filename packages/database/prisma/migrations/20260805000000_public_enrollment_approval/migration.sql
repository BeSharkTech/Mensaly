CREATE TYPE "PublicEnrollmentSubmissionStatus" AS ENUM ('PENDING', 'APPROVED');

ALTER TABLE "public_enrollment_submission"
  ADD COLUMN "status" "PublicEnrollmentSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "studentCpf" VARCHAR(11),
  ADD COLUMN "studentRg" VARCHAR(20),
  ADD COLUMN "guardianCpf" VARCHAR(11),
  ADD COLUMN "studentPayload" JSONB,
  ADD COLUMN "guardianPayload" JSONB,
  ADD COLUMN "planId" UUID,
  ADD COLUMN "customFieldValues" JSONB,
  ADD COLUMN "photoFileId" UUID;

UPDATE "public_enrollment_submission"
SET "status" = 'APPROVED'
WHERE "studentId" IS NOT NULL;

ALTER TABLE "public_enrollment_submission"
  ALTER COLUMN "studentId" DROP NOT NULL,
  ALTER COLUMN "guardianId" DROP NOT NULL,
  ALTER COLUMN "enrollmentId" DROP NOT NULL;

ALTER TABLE "public_enrollment_submission"
  ADD CONSTRAINT "public_enrollment_submission_photoFileId_fkey"
  FOREIGN KEY ("photoFileId") REFERENCES "stored_file"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "public_enrollment_submission_organizationId_studentCpf_key"
  ON "public_enrollment_submission"("organizationId", "studentCpf");
CREATE UNIQUE INDEX "public_enrollment_submission_organizationId_studentRg_key"
  ON "public_enrollment_submission"("organizationId", "studentRg");
CREATE INDEX "public_enrollment_submission_organizationId_status_createdAt_idx"
  ON "public_enrollment_submission"("organizationId", "status", "createdAt");
