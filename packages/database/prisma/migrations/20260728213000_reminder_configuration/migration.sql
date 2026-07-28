CREATE TYPE "ReminderTiming" AS ENUM (
  'BEFORE_DUE',
  'ON_DUE',
  'AFTER_DUE'
);

CREATE TABLE "reminder_configuration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "sendWindowStartMinute" INTEGER NOT NULL DEFAULT 480,
  "sendWindowEndMinute" INTEGER NOT NULL DEFAULT 1080,
  "dailyLimit" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reminder_configuration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminder_configuration_send_window"
    CHECK (
      "sendWindowStartMinute" BETWEEN 0 AND 1439
      AND "sendWindowEndMinute" BETWEEN 1 AND 1440
      AND "sendWindowStartMinute" < "sendWindowEndMinute"
    ),
  CONSTRAINT "reminder_configuration_daily_limit"
    CHECK ("dailyLimit" BETWEEN 1 AND 1000),
  CONSTRAINT "reminder_configuration_organizationId_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE
);

CREATE TABLE "reminder_rule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "configurationId" UUID NOT NULL,
  "timing" "ReminderTiming" NOT NULL,
  "dayOffset" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reminder_rule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminder_rule_offset"
    CHECK (
      ("timing" = 'ON_DUE' AND "dayOffset" = 0)
      OR (
        "timing" IN ('BEFORE_DUE', 'AFTER_DUE')
        AND "dayOffset" BETWEEN 1 AND 60
      )
    )
);

CREATE UNIQUE INDEX "reminder_configuration_organizationId_key"
  ON "reminder_configuration"("organizationId");

CREATE UNIQUE INDEX "reminder_configuration_organizationId_id_key"
  ON "reminder_configuration"("organizationId", "id");

CREATE UNIQUE INDEX "reminder_rule_organizationId_timing_dayOffset_key"
  ON "reminder_rule"("organizationId", "timing", "dayOffset");

CREATE INDEX "reminder_rule_configurationId_enabled_idx"
  ON "reminder_rule"("configurationId", "enabled");

ALTER TABLE "reminder_rule"
  ADD CONSTRAINT "reminder_rule_organizationId_configurationId_fkey"
  FOREIGN KEY ("organizationId", "configurationId")
  REFERENCES "reminder_configuration"("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
