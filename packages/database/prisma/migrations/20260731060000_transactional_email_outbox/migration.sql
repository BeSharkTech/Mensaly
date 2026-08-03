CREATE TYPE "TransactionalEmailKind" AS ENUM (
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'WELCOME'
);

CREATE TYPE "TransactionalEmailStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT'
);

CREATE TABLE "transactional_email" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID,
  "recipient" CITEXT NOT NULL,
  "kind" "TransactionalEmailKind" NOT NULL,
  "encryptedPayload" JSONB NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "status" "TransactionalEmailStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(3),
  "providerMessageId" VARCHAR(255),
  "lastErrorCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(1000),
  "sentAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transactional_email_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactional_email_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "transactional_email_idempotencyKey_key"
  ON "transactional_email"("idempotencyKey");
CREATE INDEX "transactional_email_status_nextAttemptAt_idx"
  ON "transactional_email"("status", "nextAttemptAt");
CREATE INDEX "transactional_email_userId_createdAt_idx"
  ON "transactional_email"("userId", "createdAt");
