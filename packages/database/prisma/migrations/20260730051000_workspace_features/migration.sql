CREATE TABLE "custom_field" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "label" VARCHAR(60) NOT NULL,
  "fieldType" VARCHAR(20) NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_field_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "custom_field_organizationId_id_key" ON "custom_field"("organizationId", "id");
CREATE INDEX "custom_field_organizationId_active_sortOrder_idx" ON "custom_field"("organizationId", "active", "sortOrder");

CREATE TABLE "student_field_value" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "fieldId" UUID NOT NULL,
  "value" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "student_field_value_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "student_field_value_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "student_field_value_student_fkey"
    FOREIGN KEY ("organizationId", "studentId") REFERENCES "student"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "student_field_value_field_fkey"
    FOREIGN KEY ("organizationId", "fieldId") REFERENCES "custom_field"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "product" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "stockQuantity" INTEGER NOT NULL,
  "imageDataUrl" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_price_nonnegative" CHECK ("priceCents" >= 0),
  CONSTRAINT "product_stock_nonnegative" CHECK ("stockQuantity" >= 0),
  CONSTRAINT "product_status_valid" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE "event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "location" VARCHAR(160) NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3),
  "priceCents" INTEGER NOT NULL,
  "imageDataUrl" TEXT,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "event_price_nonnegative" CHECK ("priceCents" >= 0),
  CONSTRAINT "event_status_valid" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "event_date_range_valid" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt")
);

CREATE TABLE "broadcast_message" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "targetType" VARCHAR(20) NOT NULL,
  "planId" UUID,
  "productId" UUID,
  "eventId" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "scheduledFor" TIMESTAMPTZ(3),
  "scheduleType" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  "dayOfMonth" INTEGER,
  "weekday" INTEGER,
  "sendTime" VARCHAR(5) NOT NULL DEFAULT '09:00',
  "repeatUntil" DATE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "broadcast_message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broadcast_message_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "broadcast_target_valid" CHECK ("targetType" IN ('GENERAL', 'PLAN', 'PRODUCT', 'EVENT', 'FORM')),
  CONSTRAINT "broadcast_schedule_valid" CHECK ("scheduleType" IN ('MANUAL', 'ONCE', 'DAILY', 'WEEKLY', 'MONTHLY')),
  CONSTRAINT "broadcast_month_day_valid" CHECK ("dayOfMonth" IS NULL OR "dayOfMonth" BETWEEN 1 AND 28),
  CONSTRAINT "broadcast_weekday_valid" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6)
);

CREATE UNIQUE INDEX "broadcast_message_organizationId_id_key" ON "broadcast_message"("organizationId", "id");
CREATE INDEX "broadcast_message_organizationId_active_createdAt_idx" ON "broadcast_message"("organizationId", "active", "createdAt");

CREATE TABLE "broadcast_send" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "studentId" UUID,
  "studentName" VARCHAR(120) NOT NULL,
  "recipient" VARCHAR(20) NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'QUEUED',
  "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduledFor" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "broadcast_send_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broadcast_send_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "broadcast_send_message_fkey"
    FOREIGN KEY ("organizationId", "messageId") REFERENCES "broadcast_message"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "student_field_value_organizationId_studentId_fieldId_key" ON "student_field_value"("organizationId", "studentId", "fieldId");
CREATE INDEX "student_field_value_organizationId_fieldId_idx" ON "student_field_value"("organizationId", "fieldId");
CREATE UNIQUE INDEX "product_organizationId_id_key" ON "product"("organizationId", "id");
CREATE INDEX "product_organizationId_status_createdAt_idx" ON "product"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "event_organizationId_id_key" ON "event"("organizationId", "id");
CREATE INDEX "event_organizationId_status_startsAt_idx" ON "event"("organizationId", "status", "startsAt");
CREATE UNIQUE INDEX "broadcast_send_organizationId_id_key" ON "broadcast_send"("organizationId", "id");
CREATE INDEX "broadcast_send_organizationId_messageId_status_idx" ON "broadcast_send"("organizationId", "messageId", "status");
