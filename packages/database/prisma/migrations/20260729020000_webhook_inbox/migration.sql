CREATE TYPE "WebhookEventStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT'
);

CREATE TYPE "WebhookAttemptStatus" AS ENUM (
  'STARTED',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT'
);

CREATE TABLE "webhook_event" (
  "id" UUID NOT NULL,
  "organizationId" UUID,
  "provider" VARCHAR(80) NOT NULL,
  "externalEventId" VARCHAR(255) NOT NULL,
  "eventType" VARCHAR(160) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(1000),
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMPTZ(3),
  "processedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "nextAttemptAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_event_attempt" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "WebhookAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "errorCode" VARCHAR(120),
  "errorMessage" VARCHAR(1000),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "webhook_event_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_event_provider_externalEventId_key"
  ON "webhook_event"("provider", "externalEventId");
CREATE INDEX "webhook_event_status_nextAttemptAt_receivedAt_idx"
  ON "webhook_event"("status", "nextAttemptAt", "receivedAt");
CREATE INDEX "webhook_event_organizationId_status_receivedAt_idx"
  ON "webhook_event"("organizationId", "status", "receivedAt");
CREATE UNIQUE INDEX "webhook_event_attempt_eventId_attemptNumber_key"
  ON "webhook_event_attempt"("eventId", "attemptNumber");
CREATE INDEX "webhook_event_attempt_eventId_startedAt_idx"
  ON "webhook_event_attempt"("eventId", "startedAt");

ALTER TABLE "webhook_event"
  ADD CONSTRAINT "webhook_event_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_event_attempt"
  ADD CONSTRAINT "webhook_event_attempt_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "webhook_event"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
