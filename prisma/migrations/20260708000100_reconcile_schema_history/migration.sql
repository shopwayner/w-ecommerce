-- CreateEnum
CREATE TYPE "MarketplaceCategoryProvider" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'TIKTOK_SHOP', 'AMAZON', 'MAGALU', 'OTHER');

-- CreateEnum
CREATE TYPE "MarketplaceCategorySource" AS ENUM ('MANUAL', 'INTERNAL_RULE', 'MARKETPLACE_API', 'IMPORTED');

-- CreateEnum
CREATE TYPE "MarketplaceCategoryStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MarketplaceProductAttributeSource" AS ENUM ('MANUAL', 'PRODUCT_FIELD', 'GTIN_CATALOG', 'RULE');

-- CreateEnum
CREATE TYPE "MarketplaceProductAttributeStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'EMPTY');

-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuditRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "confirmation" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "riskLevel" "AuditRiskLevel" NOT NULL DEFAULT 'LOW',
ADD COLUMN     "route" TEXT,
ADD COLUMN     "status" "AuditLogStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "userEmail" TEXT,
ADD COLUMN     "userRole" TEXT,
ALTER COLUMN "organizationId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BlingConnection" ADD COLUMN     "externalAccountEmail" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastProductSyncAt" TIMESTAMP(3),
ADD COLUMN     "selectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MercadoLivreConnection" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "sellerNickname" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BRL',
ADD COLUMN     "customerDocument" TEXT,
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "externalOrderId" TEXT,
ADD COLUMN     "externalStatusCode" TEXT,
ADD COLUMN     "externalStatusName" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceExternalId" TEXT,
ADD COLUMN     "invoiceIssuedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceKey" TEXT,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoiceStatus" TEXT,
ADD COLUMN     "lastStatusSyncAt" TIMESTAMP(3),
ADD COLUMN     "orderNumber" TEXT,
ADD COLUMN     "orderSituationId" TEXT,
ADD COLUMN     "orderSituationName" TEXT,
ADD COLUMN     "orderedAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" TEXT,
ADD COLUMN     "rawJson" JSONB,
ADD COLUMN     "shippingStatus" TEXT,
ADD COLUMN     "sourceConnectionId" TEXT,
ADD COLUMN     "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "statusSyncWarnings" JSONB,
ADD COLUMN     "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderExternalMapping" ADD COLUMN     "sourceProvider" TEXT NOT NULL DEFAULT 'BLING';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "externalProductId" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rawJson" JSONB,
ADD COLUMN     "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "productId" DROP NOT NULL,
ALTER COLUMN "sku" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "confidenceScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depth" DECIMAL(10,3),
ADD COLUMN     "enrichmentStatus" TEXT NOT NULL DEFAULT 'IMPORTED',
ADD COLUMN     "height" DECIMAL(10,3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "syncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
ADD COLUMN     "weight" DECIMAL(10,3),
ADD COLUMN     "width" DECIMAL(10,3),
ALTER COLUMN "sku" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MercadoLivreListingCache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mercadoLivreConnectionId" TEXT NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "gtin" TEXT,
    "brand" TEXT,
    "partNumber" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "price" DECIMAL(12,2),
    "currencyId" TEXT,
    "status" TEXT,
    "permalink" TEXT,
    "thumbnail" TEXT,
    "rawAttributesJson" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreListingCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
    "blingConnectionId" TEXT,
    "provider" "ERPProvider" NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalFetched" INTEGER NOT NULL DEFAULT 0,
    "totalCreatedDrafts" INTEGER NOT NULL DEFAULT 0,
    "totalUpdatedDrafts" INTEGER NOT NULL DEFAULT 0,
    "totalExistingProducts" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "currentPage" INTEGER NOT NULL DEFAULT 1,
    "lastCursor" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErpSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlingProductImportDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
    "blingConnectionId" TEXT,
    "externalId" TEXT NOT NULL,
    "sku" TEXT,
    "gtin" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "costPrice" DECIMAL(12,2),
    "stock" INTEGER,
    "unit" TEXT,
    "imageUrl" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "ncm" TEXT,
    "supplierName" TEXT,
    "supplierCode" TEXT,
    "weight" DECIMAL(10,3),
    "height" DECIMAL(10,3),
    "width" DECIMAL(10,3),
    "depth" DECIMAL(10,3),
    "status" TEXT,
    "rawData" JSONB,
    "importStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "confidenceScore" INTEGER,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlingProductImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoLivreReferenceImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MERCADO_LIVRE',
    "externalItemId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "gtin" TEXT,
    "brand" TEXT,
    "partNumber" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "price" DECIMAL(12,2),
    "currencyId" TEXT,
    "permalink" TEXT,
    "thumbnail" TEXT,
    "picturesJson" JSONB,
    "attributesJson" JSONB,
    "rawSanitizedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreReferenceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MERCADO_LIVRE',
    "sourceExternalId" TEXT,
    "sourceUrl" TEXT,
    "compatibilityLevel" TEXT,
    "compatibilityScore" INTEGER,
    "confirmationMainUsed" BOOLEAN NOT NULL DEFAULT false,
    "confirmationLowCompatibilityUsed" BOOLEAN NOT NULL DEFAULT false,
    "fieldsChangedJson" JSONB NOT NULL,
    "oldValuesJson" JSONB NOT NULL,
    "newValuesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEnrichmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "MarketplaceCategoryCatalog" (
    "id" TEXT NOT NULL,
    "provider" "MarketplaceCategoryProvider" NOT NULL,
    "siteId" TEXT,
    "marketplaceCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentMarketplaceCategoryId" TEXT,
    "isLeaf" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER,
    "attributesJson" JSONB,
    "rawJson" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceCategoryCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalGtinCatalog" (
    "id" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "normalizedGtin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "optimizedTitle" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "descriptionShort" TEXT,
    "descriptionFull" TEXT,
    "technicalDescription" TEXT,
    "imageUrl" TEXT,
    "unit" TEXT,
    "ncm" TEXT,
    "weight" DECIMAL(10,3),
    "height" DECIMAL(10,3),
    "width" DECIMAL(10,3),
    "depth" DECIMAL(10,3),
    "attributesJson" JSONB,
    "imagesJson" JSONB,
    "metadataJson" JSONB,
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalGtinCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIntegrationContextPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'MATRIX',
    "provider" TEXT,
    "blingConnectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegrationContextPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_organizationId_idx" ON "MercadoLivreListingCache"("organizationId");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_idx" ON "MercadoLivreListingCache"("mercadoLivreConnectionId");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_organizationId_mercadoLivreConnect_idx" ON "MercadoLivreListingCache"("organizationId", "mercadoLivreConnectionId");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_sku_idx" ON "MercadoLivreListingCache"("sku");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_gtin_idx" ON "MercadoLivreListingCache"("gtin");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_title_idx" ON "MercadoLivreListingCache"("title");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_categoryId_idx" ON "MercadoLivreListingCache"("categoryId");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_status_idx" ON "MercadoLivreListingCache"("status");

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_lastSyncedAt_idx" ON "MercadoLivreListingCache"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_externalI_key" ON "MercadoLivreListingCache"("mercadoLivreConnectionId", "externalItemId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_organizationId_idx" ON "ErpSyncJob"("organizationId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_erpConnectionId_idx" ON "ErpSyncJob"("erpConnectionId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_blingConnectionId_idx" ON "ErpSyncJob"("blingConnectionId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_provider_idx" ON "ErpSyncJob"("provider");

-- CreateIndex
CREATE INDEX "ErpSyncJob_type_idx" ON "ErpSyncJob"("type");

-- CreateIndex
CREATE INDEX "ErpSyncJob_status_idx" ON "ErpSyncJob"("status");

-- CreateIndex
CREATE INDEX "ErpSyncJob_updatedAt_idx" ON "ErpSyncJob"("updatedAt");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_organizationId_idx" ON "BlingProductImportDraft"("organizationId");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_erpConnectionId_idx" ON "BlingProductImportDraft"("erpConnectionId");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_blingConnectionId_idx" ON "BlingProductImportDraft"("blingConnectionId");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_importStatus_idx" ON "BlingProductImportDraft"("importStatus");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_sku_idx" ON "BlingProductImportDraft"("sku");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_gtin_idx" ON "BlingProductImportDraft"("gtin");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_updatedAt_idx" ON "BlingProductImportDraft"("updatedAt");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_lastFetchedAt_idx" ON "BlingProductImportDraft"("lastFetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlingProductImportDraft_organizationId_blingConnectionId_ex_key" ON "BlingProductImportDraft"("organizationId", "blingConnectionId", "externalId");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_organizationId_idx" ON "MercadoLivreReferenceImport"("organizationId");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_productId_idx" ON "MercadoLivreReferenceImport"("productId");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_externalItemId_idx" ON "MercadoLivreReferenceImport"("externalItemId");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_organizationId_externalItemId_idx" ON "MercadoLivreReferenceImport"("organizationId", "externalItemId");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_status_idx" ON "MercadoLivreReferenceImport"("status");

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_createdAt_idx" ON "MercadoLivreReferenceImport"("createdAt");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_organizationId_idx" ON "ProductEnrichmentHistory"("organizationId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_productId_idx" ON "ProductEnrichmentHistory"("productId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_userId_idx" ON "ProductEnrichmentHistory"("userId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_sourceProvider_idx" ON "ProductEnrichmentHistory"("sourceProvider");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_sourceExternalId_idx" ON "ProductEnrichmentHistory"("sourceExternalId");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_compatibilityLevel_idx" ON "ProductEnrichmentHistory"("compatibilityLevel");

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_createdAt_idx" ON "ProductEnrichmentHistory"("createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_organizationId_idx" ON "MarketplaceCategoryMapping"("organizationId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_productId_idx" ON "MarketplaceCategoryMapping"("productId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_internalGtinCatalogId_idx" ON "MarketplaceCategoryMapping"("internalGtinCatalogId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_provider_idx" ON "MarketplaceCategoryMapping"("provider");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_status_idx" ON "MarketplaceCategoryMapping"("status");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_updatedAt_idx" ON "MarketplaceCategoryMapping"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategoryMapping_organizationId_productId_provide_key" ON "MarketplaceCategoryMapping"("organizationId", "productId", "provider");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_organizationId_idx" ON "MarketplaceProductAttributeValue"("organizationId");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_productId_idx" ON "MarketplaceProductAttributeValue"("productId");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_mappingId_idx" ON "MarketplaceProductAttributeValue"("mappingId");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_provider_idx" ON "MarketplaceProductAttributeValue"("provider");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_marketplaceCategoryId_idx" ON "MarketplaceProductAttributeValue"("marketplaceCategoryId");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_attributeId_idx" ON "MarketplaceProductAttributeValue"("attributeId");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_status_idx" ON "MarketplaceProductAttributeValue"("status");

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_updatedAt_idx" ON "MarketplaceProductAttributeValue"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProductAttributeValue_mappingId_attributeId_key" ON "MarketplaceProductAttributeValue"("mappingId", "attributeId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_provider_idx" ON "MarketplaceCategoryCatalog"("provider");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_siteId_idx" ON "MarketplaceCategoryCatalog"("siteId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_parentMarketplaceCategoryId_idx" ON "MarketplaceCategoryCatalog"("parentMarketplaceCategoryId");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_name_idx" ON "MarketplaceCategoryCatalog"("name");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_path_idx" ON "MarketplaceCategoryCatalog"("path");

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_lastSyncedAt_idx" ON "MarketplaceCategoryCatalog"("lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategoryCatalog_provider_marketplaceCategoryId_key" ON "MarketplaceCategoryCatalog"("provider", "marketplaceCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalGtinCatalog_normalizedGtin_key" ON "InternalGtinCatalog"("normalizedGtin");

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_gtin_idx" ON "InternalGtinCatalog"("gtin");

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_normalizedGtin_idx" ON "InternalGtinCatalog"("normalizedGtin");

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_approved_idx" ON "InternalGtinCatalog"("approved");

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_confidenceScore_idx" ON "InternalGtinCatalog"("confidenceScore");

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_updatedAt_idx" ON "InternalGtinCatalog"("updatedAt");

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_organizationId_idx" ON "UserIntegrationContextPreference"("organizationId");

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_userId_idx" ON "UserIntegrationContextPreference"("userId");

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_mode_idx" ON "UserIntegrationContextPreference"("mode");

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_provider_idx" ON "UserIntegrationContextPreference"("provider");

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_blingConnectionId_idx" ON "UserIntegrationContextPreference"("blingConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegrationContextPreference_organizationId_userId_key" ON "UserIntegrationContextPreference"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_status_idx" ON "AuditLog"("status");

-- CreateIndex
CREATE INDEX "AuditLog_riskLevel_idx" ON "AuditLog"("riskLevel");

-- CreateIndex
CREATE INDEX "AuditLog_route_idx" ON "AuditLog"("route");

-- CreateIndex
CREATE INDEX "BlingConnection_organizationId_isDefault_idx" ON "BlingConnection"("organizationId", "isDefault");

-- CreateIndex
CREATE INDEX "BlingConnection_selectedAt_idx" ON "BlingConnection"("selectedAt");

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_organizationId_isDefault_idx" ON "MercadoLivreConnection"("organizationId", "isDefault");

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_lastSyncAt_idx" ON "MercadoLivreConnection"("lastSyncAt");

-- CreateIndex
CREATE INDEX "Order_sourceProvider_idx" ON "Order"("sourceProvider");

-- CreateIndex
CREATE INDEX "Order_sourceConnectionId_idx" ON "Order"("sourceConnectionId");

-- CreateIndex
CREATE INDEX "Order_externalOrderId_idx" ON "Order"("externalOrderId");

-- CreateIndex
CREATE INDEX "Order_externalStatusCode_idx" ON "Order"("externalStatusCode");

-- CreateIndex
CREATE INDEX "Order_orderSituationId_idx" ON "Order"("orderSituationId");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- CreateIndex
CREATE INDEX "Order_shippingStatus_idx" ON "Order"("shippingStatus");

-- CreateIndex
CREATE INDEX "Order_invoiceStatus_idx" ON "Order"("invoiceStatus");

-- CreateIndex
CREATE INDEX "Order_orderedAt_idx" ON "Order"("orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_sourceProvider_sourceConnectionId_exte_key" ON "Order"("organizationId", "sourceProvider", "sourceConnectionId", "externalOrderId");

-- CreateIndex
CREATE INDEX "OrderExternalMapping_sourceProvider_idx" ON "OrderExternalMapping"("sourceProvider");

-- CreateIndex
CREATE UNIQUE INDEX "OrderExternalMapping_organizationId_sourceProvider_connecti_key" ON "OrderExternalMapping"("organizationId", "sourceProvider", "connectionId", "externalOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_externalProductId_idx" ON "OrderItem"("externalProductId");

-- CreateIndex
CREATE INDEX "Product_enrichmentStatus_idx" ON "Product"("enrichmentStatus");

-- CreateIndex
CREATE INDEX "Product_syncStatus_idx" ON "Product"("syncStatus");

-- AddForeignKey
ALTER TABLE "MercadoLivreListingCache" ADD CONSTRAINT "MercadoLivreListingCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingCache" ADD CONSTRAINT "MercadoLivreListingCache_mercadoLivreConnectionId_fkey" FOREIGN KEY ("mercadoLivreConnectionId") REFERENCES "MercadoLivreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreReferenceImport" ADD CONSTRAINT "MercadoLivreReferenceImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreReferenceImport" ADD CONSTRAINT "MercadoLivreReferenceImport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_internalGtinCatalogId_fkey" FOREIGN KEY ("internalGtinCatalogId") REFERENCES "InternalGtinCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "MarketplaceCategoryMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

