CREATE TYPE "MercadoPagoConnectionStatus" AS ENUM ('CONNECTED', 'TOKEN_EXPIRED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "MercadoPagoCheckoutStatus" AS ENUM ('OPEN', 'PROCESSING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'DISPUTED');

CREATE TABLE "mercado_pago_connection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "mercadoPagoUserId" VARCHAR(64) NOT NULL,
    "publicKey" VARCHAR(255) NOT NULL,
    "encryptedAccessToken" JSONB NOT NULL,
    "encryptedRefreshToken" JSONB NOT NULL,
    "status" "MercadoPagoConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "scopes" VARCHAR(500) NOT NULL,
    "tokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastRefreshedAt" TIMESTAMPTZ(3),
    "disconnectedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(120),
    "lastErrorMessage" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "mercado_pago_connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mercado_pago_oauth_state" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stateHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mercado_pago_oauth_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mercado_pago_checkout" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "mercadoPagoUserId" VARCHAR(64) NOT NULL,
    "mercadoPagoOrderId" VARCHAR(255),
    "mercadoPagoPaymentId" VARCHAR(255),
    "publicTokenHash" VARCHAR(64) NOT NULL,
    "status" "MercadoPagoCheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "providerAttemptVersion" INTEGER NOT NULL DEFAULT 0,
    "providerLeaseUntil" TIMESTAMPTZ(3),
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'brl',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastProviderEventAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(120),
    "lastErrorMessage" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "mercado_pago_checkout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mercado_pago_connection_organizationId_key" ON "mercado_pago_connection"("organizationId");
CREATE UNIQUE INDEX "mercado_pago_connection_mercadoPagoUserId_key" ON "mercado_pago_connection"("mercadoPagoUserId");
CREATE UNIQUE INDEX "mercado_pago_connection_organizationId_id_key" ON "mercado_pago_connection"("organizationId", "id");
CREATE INDEX "mercado_pago_connection_status_tokenExpiresAt_idx" ON "mercado_pago_connection"("status", "tokenExpiresAt");

CREATE UNIQUE INDEX "mercado_pago_oauth_state_stateHash_key" ON "mercado_pago_oauth_state"("stateHash");
CREATE INDEX "mercado_pago_oauth_state_organizationId_expiresAt_idx" ON "mercado_pago_oauth_state"("organizationId", "expiresAt");
CREATE INDEX "mercado_pago_oauth_state_userId_expiresAt_idx" ON "mercado_pago_oauth_state"("userId", "expiresAt");

CREATE UNIQUE INDEX "mercado_pago_checkout_mercadoPagoOrderId_key" ON "mercado_pago_checkout"("mercadoPagoOrderId");
CREATE UNIQUE INDEX "mercado_pago_checkout_mercadoPagoPaymentId_key" ON "mercado_pago_checkout"("mercadoPagoPaymentId");
CREATE UNIQUE INDEX "mercado_pago_checkout_publicTokenHash_key" ON "mercado_pago_checkout"("publicTokenHash");
CREATE UNIQUE INDEX "mercado_pago_checkout_organizationId_id_key" ON "mercado_pago_checkout"("organizationId", "id");
CREATE INDEX "mercado_pago_checkout_organizationId_chargeId_status_idx" ON "mercado_pago_checkout"("organizationId", "chargeId", "status");
CREATE INDEX "mercado_pago_checkout_organizationId_status_expiresAt_idx" ON "mercado_pago_checkout"("organizationId", "status", "expiresAt");

ALTER TABLE "mercado_pago_connection" ADD CONSTRAINT "mercado_pago_connection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_oauth_state" ADD CONSTRAINT "mercado_pago_oauth_state_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_oauth_state" ADD CONSTRAINT "mercado_pago_oauth_state_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_checkout" ADD CONSTRAINT "mercado_pago_checkout_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_checkout" ADD CONSTRAINT "mercado_pago_checkout_connection_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "mercado_pago_connection"("organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_checkout" ADD CONSTRAINT "mercado_pago_checkout_charge_fkey"
  FOREIGN KEY ("organizationId", "chargeId") REFERENCES "charge"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mercado_pago_checkout" ADD CONSTRAINT "mercado_pago_checkout_amount_positive"
  CHECK ("amountCents" > 0);
