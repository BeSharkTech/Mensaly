CREATE TYPE "PlanFrequency" AS ENUM ('MONTHLY');
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "GuardianStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

CREATE TABLE "plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL, "description" VARCHAR(1000), "amountCents" INTEGER NOT NULL,
  "dueDay" INTEGER NOT NULL, "frequency" "PlanFrequency" NOT NULL DEFAULT 'MONTHLY',
  "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, CONSTRAINT "plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plan_amount_positive" CHECK ("amountCents" > 0), CONSTRAINT "plan_due_day" CHECK ("dueDay" BETWEEN 1 AND 31)
);
CREATE TABLE "student" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL, "name" VARCHAR(120) NOT NULL,
  "email" CITEXT, "phone" VARCHAR(20), "notes" VARCHAR(2000), "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "student_pkey" PRIMARY KEY ("id"), CONSTRAINT "student_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "guardian" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL, "name" VARCHAR(120) NOT NULL,
  "taxId" VARCHAR(14), "phone" VARCHAR(20) NOT NULL, "email" CITEXT, "status" "GuardianStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "guardian_pkey" PRIMARY KEY ("id"), CONSTRAINT "guardian_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "student_guardian" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL, "studentId" UUID NOT NULL, "guardianId" UUID NOT NULL,
  "relationship" VARCHAR(80), "active" BOOLEAN NOT NULL DEFAULT true, "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMPTZ(3),
  CONSTRAINT "student_guardian_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_guardian_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "student_guardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "enrollment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL, "studentId" UUID NOT NULL, "guardianId" UUID NOT NULL, "planId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL, "dueDay" INTEGER NOT NULL, "discountCents" INTEGER NOT NULL DEFAULT 0, "startDate" DATE NOT NULL, "endDate" DATE,
  "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE', "planNameSnapshot" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "enrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "enrollment_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "enrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "enrollment_amount_positive" CHECK ("amountCents" > 0), CONSTRAINT "enrollment_discount_nonnegative" CHECK ("discountCents" >= 0), CONSTRAINT "enrollment_due_day" CHECK ("dueDay" BETWEEN 1 AND 31)
);
CREATE INDEX "plan_organizationId_status_idx" ON "plan"("organizationId", "status");
CREATE INDEX "student_organizationId_status_name_idx" ON "student"("organizationId", "status", "name");
CREATE INDEX "guardian_organizationId_status_name_idx" ON "guardian"("organizationId", "status", "name");
CREATE UNIQUE INDEX "guardian_organizationId_taxId_key" ON "guardian"("organizationId", "taxId");
CREATE INDEX "student_guardian_organizationId_studentId_active_idx" ON "student_guardian"("organizationId", "studentId", "active");
CREATE INDEX "student_guardian_organizationId_guardianId_active_idx" ON "student_guardian"("organizationId", "guardianId", "active");
CREATE INDEX "enrollment_organizationId_status_idx" ON "enrollment"("organizationId", "status");
CREATE INDEX "enrollment_organizationId_studentId_idx" ON "enrollment"("organizationId", "studentId");
