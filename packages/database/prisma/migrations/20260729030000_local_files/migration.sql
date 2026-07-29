CREATE TYPE "StoredFileStatus" AS ENUM (
  'UPLOADING',
  'ACTIVE',
  'DELETING',
  'DELETED',
  'FAILED'
);

CREATE TABLE "stored_file" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "uploadedByUserId" UUID NOT NULL,
  "storageProvider" VARCHAR(40) NOT NULL DEFAULT 'LOCAL',
  "storageKey" VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "status" "StoredFileStatus" NOT NULL DEFAULT 'UPLOADING',
  "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "stored_file_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stored_file_storageKey_key"
  ON "stored_file"("storageKey");
CREATE UNIQUE INDEX "stored_file_organizationId_id_key"
  ON "stored_file"("organizationId", "id");
CREATE INDEX "stored_file_organizationId_status_createdAt_idx"
  ON "stored_file"("organizationId", "status", "createdAt");
CREATE INDEX "stored_file_uploadedByUserId_createdAt_idx"
  ON "stored_file"("uploadedByUserId", "createdAt");

ALTER TABLE "stored_file"
  ADD CONSTRAINT "stored_file_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stored_file"
  ADD CONSTRAINT "stored_file_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
