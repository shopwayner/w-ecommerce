-- Add product enrichment and synchronization metadata.
ALTER TABLE "Product"
ADD COLUMN "attributes" JSONB,
ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "depth" DECIMAL(10,3),
ADD COLUMN "enrichmentStatus" TEXT NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN "height" DECIMAL(10,3),
ADD COLUMN "source" TEXT,
ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
ADD COLUMN "weight" DECIMAL(10,3),
ADD COLUMN "width" DECIMAL(10,3);

-- Store tenant-scoped enriched product data reusable by GTIN.
CREATE TABLE "InternalGtinCatalog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "gtin" TEXT NOT NULL,
  "optimizedTitle" TEXT NOT NULL,
  "shortDescription" TEXT,
  "fullDescription" TEXT,
  "brand" TEXT,
  "category" TEXT,
  "weight" DECIMAL(10,3),
  "height" DECIMAL(10,3),
  "width" DECIMAL(10,3),
  "depth" DECIMAL(10,3),
  "attributes" JSONB,
  "images" JSONB,
  "source" TEXT,
  "confidenceScore" INTEGER NOT NULL DEFAULT 0,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InternalGtinCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternalGtinCatalog_organizationId_gtin_key" ON "InternalGtinCatalog"("organizationId", "gtin");
CREATE INDEX "InternalGtinCatalog_organizationId_idx" ON "InternalGtinCatalog"("organizationId");
CREATE INDEX "InternalGtinCatalog_gtin_idx" ON "InternalGtinCatalog"("gtin");
CREATE INDEX "InternalGtinCatalog_approved_idx" ON "InternalGtinCatalog"("approved");
CREATE INDEX "InternalGtinCatalog_confidenceScore_idx" ON "InternalGtinCatalog"("confidenceScore");
CREATE INDEX "InternalGtinCatalog_updatedAt_idx" ON "InternalGtinCatalog"("updatedAt");
CREATE INDEX "Product_enrichmentStatus_idx" ON "Product"("enrichmentStatus");
CREATE INDEX "Product_syncStatus_idx" ON "Product"("syncStatus");

ALTER TABLE "InternalGtinCatalog"
ADD CONSTRAINT "InternalGtinCatalog_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
