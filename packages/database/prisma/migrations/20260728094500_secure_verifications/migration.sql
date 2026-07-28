CREATE TYPE "VerificationType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

ALTER TABLE "verification" RENAME COLUMN "value" TO "tokenHash";
ALTER TABLE "verification" ALTER COLUMN "tokenHash" TYPE VARCHAR(64);
ALTER TABLE "verification" ADD COLUMN "type" "VerificationType" NOT NULL DEFAULT 'EMAIL_VERIFICATION';
ALTER TABLE "verification" ALTER COLUMN "type" DROP DEFAULT;

CREATE UNIQUE INDEX "verification_tokenHash_key" ON "verification"("tokenHash");
DROP INDEX "verification_identifier_idx";
CREATE INDEX "verification_identifier_type_createdAt_idx" ON "verification"("identifier", "type", "createdAt");
