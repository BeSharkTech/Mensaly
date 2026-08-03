CREATE TYPE "TransactionalEmailDeliveryStatus" AS ENUM (
  'UNKNOWN',
  'DELIVERED',
  'DELIVERY_DELAYED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED'
);

ALTER TABLE "transactional_email"
  ADD COLUMN "deliveryStatus" "TransactionalEmailDeliveryStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "providerEventAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveryError" VARCHAR(1000);

CREATE INDEX "transactional_email_providerMessageId_idx"
  ON "transactional_email"("providerMessageId");
