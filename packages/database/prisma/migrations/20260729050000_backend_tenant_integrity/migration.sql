ALTER TABLE "student_guardian"
  DROP CONSTRAINT "student_guardian_studentId_fkey",
  DROP CONSTRAINT "student_guardian_guardianId_fkey";

ALTER TABLE "enrollment"
  DROP CONSTRAINT "enrollment_studentId_fkey",
  DROP CONSTRAINT "enrollment_guardianId_fkey",
  DROP CONSTRAINT "enrollment_planId_fkey",
  DROP CONSTRAINT "enrollment_discount_within_amount";

CREATE UNIQUE INDEX "plan_organizationId_id_key"
  ON "plan"("organizationId", "id");

CREATE UNIQUE INDEX "student_organizationId_id_key"
  ON "student"("organizationId", "id");

CREATE UNIQUE INDEX "guardian_organizationId_id_key"
  ON "guardian"("organizationId", "id");

CREATE UNIQUE INDEX "student_guardian_organizationId_studentId_guardianId_key"
  ON "student_guardian"("organizationId", "studentId", "guardianId");

ALTER TABLE "student_guardian"
  ADD CONSTRAINT "student_guardian_organizationId_studentId_fkey"
    FOREIGN KEY ("organizationId", "studentId")
    REFERENCES "student"("organizationId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  ADD CONSTRAINT "student_guardian_organizationId_guardianId_fkey"
    FOREIGN KEY ("organizationId", "guardianId")
    REFERENCES "guardian"("organizationId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_organizationId_studentId_fkey"
    FOREIGN KEY ("organizationId", "studentId")
    REFERENCES "student"("organizationId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  ADD CONSTRAINT "enrollment_organizationId_guardianId_fkey"
    FOREIGN KEY ("organizationId", "guardianId")
    REFERENCES "guardian"("organizationId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  ADD CONSTRAINT "enrollment_organizationId_planId_fkey"
    FOREIGN KEY ("organizationId", "planId")
    REFERENCES "plan"("organizationId", "id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  ADD CONSTRAINT "enrollment_discount_below_amount"
    CHECK ("discountCents" < "amountCents"),
  ADD CONSTRAINT "enrollment_valid_date_range"
    CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
