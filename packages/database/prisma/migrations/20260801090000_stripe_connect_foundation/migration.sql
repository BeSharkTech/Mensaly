CREATE TYPE "StripeConnectionStatus" AS ENUM (
  'PENDING_CREATION',
  'ONBOARDING',
  'REQUIREMENTS_DUE',
  'UNDER_REVIEW',
  'ENABLED',
  'RESTRICTED',
  'DISCONNECTED'
);

CREATE TYPE "StripeCheckoutStatus" AS ENUM (
  'CREATING',
  'OPEN',
  'PROCESSING',
  'PAID',
  'EXPIRED',
  'FAILED',
  'REFUNDED',
  'DISPUTED'
);

CREATE TABLE "stripe_connection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "stripeAccountId" VARCHAR(255),
  "status" "StripeConnectionStatus" NOT NULL DEFAULT 'PENDING_CREATION',
  "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  "capabilities" JSONB,
  "requirements" JSONB,
  "creationAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "creationLeaseUntil" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(1000),
  "lastSyncedAt" TIMESTAMPTZ(3),
  "disconnectedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stripe_connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "guardianId" UUID NOT NULL,
  "stripeCustomerId" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stripe_customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_checkout" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "chargeId" UUID NOT NULL,
  "customerRecordId" UUID,
  "stripeAccountId" VARCHAR(255) NOT NULL,
  "stripeCheckoutSessionId" VARCHAR(255),
  "stripePaymentIntentId" VARCHAR(255),
  "publicTokenHash" VARCHAR(64) NOT NULL,
  "status" "StripeCheckoutStatus" NOT NULL DEFAULT 'CREATING',
  "amountCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'brl',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "providerExpiresAt" TIMESTAMPTZ(3),
  "lastProviderEventAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stripe_checkout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stripe_checkout_amount_positive" CHECK ("amountCents" > 0)
);

CREATE UNIQUE INDEX "stripe_connection_organizationId_key" ON "stripe_connection"("organizationId");
CREATE UNIQUE INDEX "stripe_connection_stripeAccountId_key" ON "stripe_connection"("stripeAccountId");
CREATE UNIQUE INDEX "stripe_connection_organizationId_id_key" ON "stripe_connection"("organizationId", "id");
CREATE INDEX "stripe_connection_status_updatedAt_idx" ON "stripe_connection"("status", "updatedAt");

CREATE UNIQUE INDEX "stripe_customer_stripeCustomerId_key" ON "stripe_customer"("stripeCustomerId");
CREATE UNIQUE INDEX "stripe_customer_organizationId_guardianId_key" ON "stripe_customer"("organizationId", "guardianId");
CREATE UNIQUE INDEX "stripe_customer_organizationId_id_key" ON "stripe_customer"("organizationId", "id");
CREATE INDEX "stripe_customer_organizationId_createdAt_idx" ON "stripe_customer"("organizationId", "createdAt");

CREATE UNIQUE INDEX "stripe_checkout_stripeCheckoutSessionId_key" ON "stripe_checkout"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "stripe_checkout_stripePaymentIntentId_key" ON "stripe_checkout"("stripePaymentIntentId");
CREATE UNIQUE INDEX "stripe_checkout_publicTokenHash_key" ON "stripe_checkout"("publicTokenHash");
CREATE UNIQUE INDEX "stripe_checkout_organizationId_id_key" ON "stripe_checkout"("organizationId", "id");
CREATE INDEX "stripe_checkout_organizationId_chargeId_status_idx" ON "stripe_checkout"("organizationId", "chargeId", "status");
CREATE INDEX "stripe_checkout_organizationId_status_expiresAt_idx" ON "stripe_checkout"("organizationId", "status", "expiresAt");

ALTER TABLE "stripe_connection" ADD CONSTRAINT "stripe_connection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stripe_customer" ADD CONSTRAINT "stripe_customer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_customer" ADD CONSTRAINT "stripe_customer_connection_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "stripe_connection"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_customer" ADD CONSTRAINT "stripe_customer_guardian_fkey"
  FOREIGN KEY ("organizationId", "guardianId") REFERENCES "guardian"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stripe_checkout" ADD CONSTRAINT "stripe_checkout_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_checkout" ADD CONSTRAINT "stripe_checkout_connection_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "stripe_connection"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_checkout" ADD CONSTRAINT "stripe_checkout_charge_fkey"
  FOREIGN KEY ("organizationId", "chargeId") REFERENCES "charge"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stripe_checkout" ADD CONSTRAINT "stripe_checkout_customer_fkey"
  FOREIGN KEY ("organizationId", "customerRecordId") REFERENCES "stripe_customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
