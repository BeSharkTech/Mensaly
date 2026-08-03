-- Existing student records may predate mandatory CPF collection. Keep the
-- column nullable for a safe rollout; the API requires CPF on every new
-- student registration and the public form only resolves active students by it.
ALTER TABLE "student" ADD COLUMN "cpf" VARCHAR(11);

CREATE UNIQUE INDEX "student_organizationId_cpf_key"
  ON "student"("organizationId", "cpf");
