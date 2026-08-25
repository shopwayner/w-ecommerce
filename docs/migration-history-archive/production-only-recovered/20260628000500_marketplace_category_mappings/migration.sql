CREATE TYPE "MarketplaceCategoryProvider" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'TIKTOK_SHOP', 'AMAZON', 'MAGALU', 'OTHER');
CREATE TYPE "MarketplaceCategorySource" AS ENUM ('MANUAL', 'INTERNAL_RULE', 'MARKETPLACE_API', 'IMPORTED');
CREATE TYPE "MarketplaceCategoryStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

CREATE TABLE "MarketplaceCategoryMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT,
  "internalGtinCatalogId" TEXT,
  "provider" "MarketplaceCategoryProvider" NOT NULL,
  "marketplaceCategoryId" TEXT,
  "marketplaceCategoryName" TEXT,
  "marketplaceCategoryPath" TEXT,
  "confidenceScore" INTEGER,
  "source" "MarketplaceCategorySource" NOT NULL DEFAULT 'MANUAL',
  "status" "MarketplaceCategoryStatus" NOT NULL DEFAULT 'SUGGESTED',
  "requiredAttributes" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceCategoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceCategoryMapping_organizationId_productId_provider_key" ON "MarketplaceCategoryMapping"("organizationId", "productId", "provider");
CREATE INDEX "MarketplaceCategoryMapping_organizationId_idx" ON "MarketplaceCategoryMapping"("organizationId");
CREATE INDEX "MarketplaceCategoryMapping_productId_idx" ON "MarketplaceCategoryMapping"("productId");
CREATE INDEX "MarketplaceCategoryMapping_internalGtinCatalogId_idx" ON "MarketplaceCategoryMapping"("internalGtinCatalogId");
CREATE INDEX "MarketplaceCategoryMapping_provider_idx" ON "MarketplaceCategoryMapping"("provider");
CREATE INDEX "MarketplaceCategoryMapping_status_idx" ON "MarketplaceCategoryMapping"("status");
CREATE INDEX "MarketplaceCategoryMapping_updatedAt_idx" ON "MarketplaceCategoryMapping"("updatedAt");

ALTER TABLE "MarketplaceCategoryMapping"
ADD CONSTRAINT "MarketplaceCategoryMapping_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceCategoryMapping"
ADD CONSTRAINT "MarketplaceCategoryMapping_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceCategoryMapping"
ADD CONSTRAINT "MarketplaceCategoryMapping_internalGtinCatalogId_fkey"
FOREIGN KEY ("internalGtinCatalogId") REFERENCES "InternalGtinCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
