-- Add account selection metadata for multiple Bling accounts.
ALTER TABLE "BlingConnection"
  ADD COLUMN IF NOT EXISTS "externalAccountEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "selectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProductSyncAt" TIMESTAMP(3);

-- Preserve current behavior by selecting the most recently updated active
-- Bling account as the default when an organization already has one.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC
    ) AS rn
  FROM "BlingConnection"
  WHERE "status" = 'ACTIVE'
)
UPDATE "BlingConnection"
SET "isDefault" = true,
    "selectedAt" = COALESCE("selectedAt", NOW())
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn = 1);

CREATE INDEX IF NOT EXISTS "BlingConnection_organizationId_isDefault_idx"
  ON "BlingConnection"("organizationId", "isDefault");
CREATE INDEX IF NOT EXISTS "BlingConnection_selectedAt_idx"
  ON "BlingConnection"("selectedAt");

-- Track which Bling account produced each staging draft so equal external IDs
-- from different Bling accounts cannot collide in future imports.
ALTER TABLE "BlingProductImportDraft"
  ADD COLUMN IF NOT EXISTS "blingConnectionId" TEXT;

UPDATE "BlingProductImportDraft" draft
SET "blingConnectionId" = connection."id"
FROM "BlingConnection" connection
WHERE draft."blingConnectionId" IS NULL
  AND draft."organizationId" = connection."organizationId"
  AND connection."isDefault" = true;

DROP INDEX IF EXISTS "BlingProductImportDraft_organizationId_externalId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BlingProductImportDraft_organizationId_blingConnectionId_externalId_key"
  ON "BlingProductImportDraft"("organizationId", "blingConnectionId", "externalId");

CREATE INDEX IF NOT EXISTS "BlingProductImportDraft_blingConnectionId_idx"
  ON "BlingProductImportDraft"("blingConnectionId");

ALTER TABLE "BlingProductImportDraft"
  ADD CONSTRAINT "BlingProductImportDraft_blingConnectionId_fkey"
  FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ErpSyncJob"
  ADD COLUMN IF NOT EXISTS "blingConnectionId" TEXT;

UPDATE "ErpSyncJob" job
SET "blingConnectionId" = connection."id"
FROM "BlingConnection" connection
WHERE job."blingConnectionId" IS NULL
  AND job."organizationId" = connection."organizationId"
  AND connection."isDefault" = true;

CREATE INDEX IF NOT EXISTS "ErpSyncJob_blingConnectionId_idx"
  ON "ErpSyncJob"("blingConnectionId");

ALTER TABLE "ErpSyncJob"
  ADD CONSTRAINT "ErpSyncJob_blingConnectionId_fkey"
  FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
