-- Convert every active legacy plan schedule into the new explicit billing rule.
INSERT INTO "billing_rule" (
  "id", "organizationId", "name", "sourceType", "sourceId",
  "sourceNameSnapshot", "amountCents", "frequency", "opensOn",
  "expiresOn", "repeatUntil", "status", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), p."organizationId", 'Mensalidade - ' || p."name",
  'PLAN'::"BillingRuleSourceType", p."id", p."name", p."amountCents",
  'MONTHLY'::"BillingRuleFrequency",
  make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int,
    LEAST(p."chargeOpenDay", EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)),
  make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int,
    LEAST(p."dueDay", EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)),
  DATE '2099-12-31',
  CASE WHEN p."status" = 'ACTIVE' THEN 'ACTIVE'::"BillingRuleStatus" ELSE 'INACTIVE'::"BillingRuleStatus" END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "plan" p;

INSERT INTO "billing_rule_target" ("id", "organizationId", "billingRuleId", "studentId", "createdAt")
SELECT gen_random_uuid(), e."organizationId", r."id", e."studentId", CURRENT_TIMESTAMP
FROM "enrollment" e
JOIN "billing_rule" r
  ON r."organizationId" = e."organizationId"
 AND r."sourceType" = 'PLAN'
 AND r."sourceId" = e."planId"
WHERE e."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;

-- Attach old monthly charges to the migrated plan rule and reuse its cycle key,
-- preventing the scheduler from duplicating the current month.
WITH ranked_charges AS (
  SELECT c."id",
    row_number() OVER (
      PARTITION BY c."organizationId", c."enrollmentId", c."referenceMonth"
      ORDER BY c."createdAt", c."id"
    ) AS position
  FROM "charge" c
  WHERE c."billingRuleId" IS NULL
)
UPDATE "charge" c
SET "billingRuleId" = r."id",
    "cycleKey" = 'rule:' || r."id"::text || ':' || to_char(c."referenceMonth", 'YYYY-MM')
FROM ranked_charges ranked, "enrollment" e, "billing_rule" r
WHERE e."id" = c."enrollmentId"
  AND ranked."id" = c."id"
  AND ranked.position = 1
  AND e."organizationId" = c."organizationId"
  AND r."organizationId" = c."organizationId"
  AND r."sourceType" = 'PLAN'
  AND r."sourceId" = e."planId"
  AND c."billingRuleId" IS NULL;
