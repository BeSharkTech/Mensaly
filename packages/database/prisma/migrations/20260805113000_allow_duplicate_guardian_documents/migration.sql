-- A guardian record belongs to one student enrollment flow. The same person may
-- therefore be entered explicitly for more than one student.
DROP INDEX IF EXISTS "guardian_organizationId_taxId_key";
