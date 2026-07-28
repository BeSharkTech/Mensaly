CREATE TYPE "MessageDeliveryAttemptStatus" AS ENUM (
  'STARTED',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT'
);

ALTER TABLE "message_schedule"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "sentAt" TIMESTAMPTZ(3),
  ADD COLUMN "sentLocalDate" DATE,
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "readAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerMessageId" VARCHAR(255),
  ADD COLUMN "lastErrorCode" VARCHAR(120),
  ADD COLUMN "lastErrorMessage" VARCHAR(1000);

CREATE TABLE "message_delivery_attempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "MessageDeliveryAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "providerMessageId" VARCHAR(255),
  "errorCode" VARCHAR(120),
  "errorMessage" VARCHAR(1000),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "message_delivery_attempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_delivery_attempt_attemptNumber_check"
    CHECK ("attemptNumber" > 0)
);

CREATE TABLE "message_recipient_block" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "phone" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "message_recipient_block_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_recipient_block_phone_check"
    CHECK ("phone" ~ '^[0-9]{8,20}$'),
  CONSTRAINT "message_recipient_block_reason_check"
    CHECK (btrim("reason") <> '')
);

CREATE UNIQUE INDEX "message_delivery_attempt_organizationId_scheduleId_attemptNumber_key"
  ON "message_delivery_attempt"("organizationId", "scheduleId", "attemptNumber");
CREATE INDEX "message_delivery_attempt_scheduleId_startedAt_idx"
  ON "message_delivery_attempt"("scheduleId", "startedAt");
CREATE INDEX "message_delivery_attempt_organizationId_status_startedAt_idx"
  ON "message_delivery_attempt"("organizationId", "status", "startedAt");
CREATE UNIQUE INDEX "message_recipient_block_organizationId_phone_key"
  ON "message_recipient_block"("organizationId", "phone");
CREATE INDEX "message_recipient_block_organizationId_active_idx"
  ON "message_recipient_block"("organizationId", "active");
CREATE INDEX "message_schedule_organizationId_sentLocalDate_idx"
  ON "message_schedule"("organizationId", "sentLocalDate");

ALTER TABLE "message_delivery_attempt"
  ADD CONSTRAINT "message_delivery_attempt_organizationId_scheduleId_fkey"
  FOREIGN KEY ("organizationId", "scheduleId")
  REFERENCES "message_schedule"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_recipient_block"
  ADD CONSTRAINT "message_recipient_block_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
