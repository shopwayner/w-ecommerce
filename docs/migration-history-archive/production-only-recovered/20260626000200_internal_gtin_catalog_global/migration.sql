-- Convert the initial tenant-scoped GTIN table into a reusable internal catalog.
-- The catalog must not store client-private product data, prices, stock, ERP ids, or tenant ids.

DROP INDEX IF EXISTS "InternalGtinCatalog_organizationId_gtin_key";
DROP INDEX IF EXISTS "InternalGtinCatalog_organizationId_idx";

ALTER TABLE "InternalGtinCatalog"
DROP CONSTRAINT IF EXISTS "InternalGtinCatalog_organizationId_fkey";

ALTER TABLE "InternalGtinCatalog"
ADD COLUMN IF NOT EXISTS "normalizedGtin" TEXT,
ADD COLUMN IF NOT EXISTS "title" TEXT,
ADD COLUMN IF NOT EXISTS "descriptionShort" TEXT,
ADD COLUMN IF NOT EXISTS "descriptionFull" TEXT,
ADD COLUMN IF NOT EXISTS "technicalDescription" TEXT,
ADD COLUMN IF NOT EXISTS "attributesJson" JSONB,
ADD COLUMN IF NOT EXISTS "imagesJson" JSONB,
ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;

UPDATE "InternalGtinCatalog"
SET
  "normalizedGtin" = regexp_replace(COALESCE("gtin", ''), '\D', '', 'g'),
  "title" = COALESCE("optimizedTitle", "gtin"),
  "descriptionShort" = "shortDescription",
  "descriptionFull" = "fullDescription",
  "attributesJson" = "attributes",
  "imagesJson" = "images"
WHERE "normalizedGtin" IS NULL OR "title" IS NULL;

DELETE FROM "InternalGtinCatalog"
WHERE "normalizedGtin" IS NULL OR "normalizedGtin" = '';

ALTER TABLE "InternalGtinCatalog"
ALTER COLUMN "normalizedGtin" SET NOT NULL,
ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE "InternalGtinCatalog"
DROP COLUMN IF EXISTS "organizationId",
DROP COLUMN IF EXISTS "shortDescription",
DROP COLUMN IF EXISTS "fullDescription",
DROP COLUMN IF EXISTS "attributes",
DROP COLUMN IF EXISTS "images";

CREATE UNIQUE INDEX IF NOT EXISTS "InternalGtinCatalog_normalizedGtin_key" ON "InternalGtinCatalog"("normalizedGtin");
CREATE INDEX IF NOT EXISTS "InternalGtinCatalog_normalizedGtin_idx" ON "InternalGtinCatalog"("normalizedGtin");
