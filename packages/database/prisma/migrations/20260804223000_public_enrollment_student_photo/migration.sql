ALTER TABLE "stored_file"
  ALTER COLUMN "uploadedByUserId" DROP NOT NULL;

ALTER TABLE "student"
  ADD COLUMN "photoFileId" UUID;

CREATE UNIQUE INDEX "student_photoFileId_key" ON "student"("photoFileId");

ALTER TABLE "student"
  ADD CONSTRAINT "student_photoFileId_fkey"
  FOREIGN KEY ("photoFileId") REFERENCES "stored_file"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
