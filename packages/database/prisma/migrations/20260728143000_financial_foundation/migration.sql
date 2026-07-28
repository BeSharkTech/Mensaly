CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'WAIVED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING_RECONCILIATION', 'CONFIRMED', 'REVERSED', 'CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'PIX', 'BANK_TRANSFER', 'CARD', 'OTHER');

CREATE TABLE "charge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "enrollmentId" UUID NOT NULL,
  "referenceMonth" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "discountCents" INTEGER NOT NULL DEFAULT 0,
  "finalAmountCents" INTEGER NOT NULL,
  "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
  "cancelledAt" TIMESTAMPTZ(3),
  "waivedAt" TIMESTAMPTZ(3),
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "charge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "charge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "charge_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "charge_amount_positive" CHECK ("amountCents" > 0),
  CONSTRAINT "charge_discount_nonnegative" CHECK ("discountCents" >= 0),
  CONSTRAINT "charge_discount_within_amount" CHECK ("discountCents" <= "amountCents"),
  CONSTRAINT "charge_final_amount" CHECK ("finalAmountCents" = "amountCents" - "discountCents")
);

CREATE TABLE "payment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "chargeId" UUID NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING_RECONCILIATION',
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "externalReference" VARCHAR(255),
  "notes" VARCHAR(1000),
  "reversedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_amount_positive" CHECK ("amountCents" > 0)
);

CREATE UNIQUE INDEX "charge_organizationId_enrollmentId_referenceMonth_key" ON "charge"("organizationId", "enrollmentId", "referenceMonth");
CREATE INDEX "charge_organizationId_status_dueDate_idx" ON "charge"("organizationId", "status", "dueDate");
CREATE INDEX "payment_organizationId_status_paidAt_idx" ON "payment"("organizationId", "status", "paidAt");
CREATE INDEX "payment_chargeId_idx" ON "payment"("chargeId");
