CREATE TYPE "MessageScheduleStatus" AS ENUM (
  'SCHEDULED',
  'QUEUED',
  'PROCESSING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'CANCELLED'
);

CREATE TABLE "message_template" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" CITEXT NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "message_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_template_body_not_blank"
    CHECK (length(btrim("body")) > 0),
  CONSTRAINT "message_template_name_not_blank"
    CHECK (length(btrim("name"::TEXT)) > 0),
  CONSTRAINT "message_template_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE "message_schedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "chargeId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "status" "MessageScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
  "deduplicationKey" VARCHAR(64) NOT NULL,
  "templateBodySnapshot" VARCHAR(4000) NOT NULL,
  "recipientNameSnapshot" VARCHAR(120) NOT NULL,
  "recipientPhoneSnapshot" VARCHAR(20) NOT NULL,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancellationReason" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "message_schedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_schedule_deduplication_key"
    CHECK ("deduplicationKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "message_schedule_cancellation"
    CHECK (
      (
        "status" = 'CANCELLED'
        AND "cancelledAt" IS NOT NULL
        AND "cancellationReason" IS NOT NULL
      )
      OR (
        "status" <> 'CANCELLED'
        AND "cancelledAt" IS NULL
        AND "cancellationReason" IS NULL
      )
    ),
  CONSTRAINT "message_schedule_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE "message_schedule_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "fromStatus" "MessageScheduleStatus",
  "toStatus" "MessageScheduleStatus" NOT NULL,
  "reason" VARCHAR(120) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_schedule_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_schedule_history_reason_not_blank"
    CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "message_template_organizationId_name_key"
  ON "message_template"("organizationId", "name");

CREATE UNIQUE INDEX "message_template_organizationId_id_key"
  ON "message_template"("organizationId", "id");

CREATE INDEX "message_template_organizationId_active_name_idx"
  ON "message_template"("organizationId", "active", "name");

CREATE UNIQUE INDEX "message_schedule_organizationId_deduplicationKey_key"
  ON "message_schedule"("organizationId", "deduplicationKey");

CREATE UNIQUE INDEX "message_schedule_organizationId_id_key"
  ON "message_schedule"("organizationId", "id");

CREATE INDEX "message_schedule_organizationId_status_scheduledFor_idx"
  ON "message_schedule"("organizationId", "status", "scheduledFor");

CREATE INDEX "message_schedule_chargeId_status_idx"
  ON "message_schedule"("chargeId", "status");

CREATE INDEX "message_schedule_history_scheduleId_createdAt_idx"
  ON "message_schedule_history"("scheduleId", "createdAt");

CREATE INDEX "message_schedule_history_organizationId_createdAt_idx"
  ON "message_schedule_history"("organizationId", "createdAt");

ALTER TABLE "message_schedule"
  ADD CONSTRAINT "message_schedule_organizationId_chargeId_fkey"
  FOREIGN KEY ("organizationId", "chargeId")
  REFERENCES "charge"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "message_schedule"
  ADD CONSTRAINT "message_schedule_organizationId_templateId_fkey"
  FOREIGN KEY ("organizationId", "templateId")
  REFERENCES "message_template"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "message_schedule_history"
  ADD CONSTRAINT "message_schedule_history_organizationId_scheduleId_fkey"
  FOREIGN KEY ("organizationId", "scheduleId")
  REFERENCES "message_schedule"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
