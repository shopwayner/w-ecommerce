CREATE TYPE "MarketplaceProductAttributeSource" AS ENUM ('MANUAL', 'PRODUCT_FIELD', 'GTIN_CATALOG', 'RULE');

CREATE TYPE "MarketplaceProductAttributeStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'EMPTY');

CREATE TABLE "MarketplaceProductAttributeValue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "provider" "MarketplaceCategoryProvider" NOT NULL,
    "marketplaceCategoryId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "value" TEXT,
    "valueId" TEXT,
    "source" "MarketplaceProductAttributeSource" NOT NULL DEFAULT 'MANUAL',
    "status" "MarketplaceProductAttributeStatus" NOT NULL DEFAULT 'EMPTY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProductAttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceProductAttributeValue_mappingId_attributeId_key" ON "MarketplaceProductAttributeValue"("mappingId", "attributeId");
CREATE INDEX "MarketplaceProductAttributeValue_organizationId_idx" ON "MarketplaceProductAttributeValue"("organizationId");
CREATE INDEX "MarketplaceProductAttributeValue_productId_idx" ON "MarketplaceProductAttributeValue"("productId");
CREATE INDEX "MarketplaceProductAttributeValue_mappingId_idx" ON "MarketplaceProductAttributeValue"("mappingId");
CREATE INDEX "MarketplaceProductAttributeValue_provider_idx" ON "MarketplaceProductAttributeValue"("provider");
CREATE INDEX "MarketplaceProductAttributeValue_marketplaceCategoryId_idx" ON "MarketplaceProductAttributeValue"("marketplaceCategoryId");
CREATE INDEX "MarketplaceProductAttributeValue_attributeId_idx" ON "MarketplaceProductAttributeValue"("attributeId");
CREATE INDEX "MarketplaceProductAttributeValue_status_idx" ON "MarketplaceProductAttributeValue"("status");
CREATE INDEX "MarketplaceProductAttributeValue_updatedAt_idx" ON "MarketplaceProductAttributeValue"("updatedAt");

ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "MarketplaceCategoryMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;
