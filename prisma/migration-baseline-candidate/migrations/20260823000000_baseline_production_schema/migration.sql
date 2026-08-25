-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuditRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BlingEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- CreateEnum
CREATE TYPE "ConflictStrategy" AS ENUM ('MATRIX_WINS', 'LATEST_WINS', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ConnectionRole" AS ENUM ('MATRIX', 'BRANCH', 'OTHER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'ERROR', 'DISABLED', 'DISCONNECTED', 'PENDING');

-- CreateEnum
CREATE TYPE "ERPProvider" AS ENUM ('BLING', 'OLIST', 'OMIE', 'CONTA_AZUL', 'CUSTOM_API');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELED');

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
CREATE TYPE "MarketplaceProvider" AS ENUM ('MERCADOLIVRE', 'MAGALU', 'SHOPEE', 'SHOPEE_ADS', 'AMAZON', 'SHEIN', 'TIKTOK_SHOP');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('BLING', 'MERCADOLIVRE');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('START', 'MATRIX', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "ProductCommercialStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('UNSPECIFIED', 'NEW', 'USED');

-- CreateEnum
CREATE TYPE "ProductDimensionUnit" AS ENUM ('METER', 'CENTIMETER', 'MILLIMETER');

-- CreateEnum
CREATE TYPE "ProductFormat" AS ENUM ('SIMPLE', 'VARIATION', 'COMPOSITION');

-- CreateEnum
CREATE TYPE "ProductProductionType" AS ENUM ('OWN', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE', 'SERVICE_06_21_22');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('MATRIX_TO_BRANCHES', 'BRANCHES_TO_MATRIX', 'BIDIRECTIONAL', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateTable
CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "module" TEXT NOT NULL,
    "marketplace" TEXT,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "safePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userEmail" TEXT,
    "userRole" TEXT,
    "entityType" TEXT,
    "route" TEXT,
    "method" TEXT,
    "confirmation" TEXT,
    "status" "AuditLogStatus" NOT NULL DEFAULT 'SUCCESS',
    "riskLevel" "AuditRiskLevel" NOT NULL DEFAULT 'LOW',
    "summary" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlingConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ConnectionRole" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "externalAccountId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "environment" "BlingEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "externalCompanyDocument" TEXT,
    "externalCompanyId" TEXT,
    "externalCompanyName" TEXT,
    "lastError" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "scopes" TEXT,
    "externalAccountEmail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "selectedAt" TIMESTAMP(3),
    "lastProductSyncAt" TIMESTAMP(3),
    "clientIdEncrypted" TEXT,
    "clientSecretEncrypted" TEXT,
    "internalNotes" TEXT,

    CONSTRAINT "BlingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlingProductImportDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sku" TEXT,
    "gtin" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2),
    "stock" INTEGER,
    "imageUrl" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "status" TEXT,
    "rawData" JSONB,
    "importStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "confidenceScore" INTEGER,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "costPrice" DECIMAL(12,2),
    "unit" TEXT,
    "ncm" TEXT,
    "supplierName" TEXT,
    "supplierCode" TEXT,
    "weight" DECIMAL(10,3),
    "height" DECIMAL(10,3),
    "width" DECIMAL(10,3),
    "depth" DECIMAL(10,3),
    "blingConnectionId" TEXT,

    CONSTRAINT "BlingProductImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlingToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',

    CONSTRAINT "BlingToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ERPConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" "ERPProvider" NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "configStatus" TEXT NOT NULL DEFAULT 'MISSING',
    "credentialsEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "externalAccountId" TEXT,
    "externalCompanyId" TEXT,
    "environment" TEXT,
    "taxRate" DECIMAL(5,2),
    "orderImportStartDate" TIMESTAMP(3),
    "productSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "orderSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stockSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "invoiceSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "internalNotes" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastConnectionTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ERPConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErpSyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
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
    "blingConnectionId" TEXT,

    CONSTRAINT "ErpSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalGtinCatalog" (
    "id" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "optimizedTitle" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "weight" DECIMAL(10,3),
    "height" DECIMAL(10,3),
    "width" DECIMAL(10,3),
    "depth" DECIMAL(10,3),
    "source" TEXT,
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "normalizedGtin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionShort" TEXT,
    "descriptionFull" TEXT,
    "technicalDescription" TEXT,
    "attributesJson" JSONB,
    "imagesJson" JSONB,
    "sourceUrl" TEXT,
    "imageUrl" TEXT,
    "unit" TEXT,
    "ncm" TEXT,
    "metadataJson" JSONB,

    CONSTRAINT "InternalGtinCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "physicalQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "safetyQuantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" "MarketplaceProvider" NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "configStatus" TEXT NOT NULL DEFAULT 'MISSING',
    "credentialsEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "externalAccountId" TEXT,
    "externalShopId" TEXT,
    "sellerId" TEXT,
    "siteId" TEXT,
    "region" TEXT,
    "marketplaceId" TEXT,
    "environment" TEXT,
    "taxRate" DECIMAL(5,2),
    "orderImportStartDate" TIMESTAMP(3),
    "internalNotes" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastConnectionTestAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "MercadoLivreConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Mercado Livre',
    "siteId" TEXT NOT NULL DEFAULT 'MLB',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "externalUserId" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountAlias" TEXT,
    "clientId" TEXT,
    "clientSecretEncrypted" TEXT,
    "redirectUri" TEXT,
    "taxRate" DECIMAL(5,2),
    "orderImportStartDate" TIMESTAMP(3),
    "configStatus" TEXT NOT NULL DEFAULT 'MISSING',
    "sellerNickname" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "MercadoLivreConnection_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL DEFAULT 'BLING',
    "stateHash" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "connectionRole" "ConnectionRole" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderNumber" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceConnectionId" TEXT,
    "externalOrderId" TEXT,
    "customerDocument" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "paymentStatus" TEXT,
    "shippingStatus" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "orderedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3),
    "rawJson" JSONB,
    "externalStatusCode" TEXT,
    "externalStatusName" TEXT,
    "orderSituationId" TEXT,
    "orderSituationName" TEXT,
    "invoiceStatus" TEXT,
    "invoiceNumber" TEXT,
    "invoiceKey" TEXT,
    "invoiceExternalId" TEXT,
    "invoiceIssuedAt" TIMESTAMP(3),
    "lastStatusSyncAt" TIMESTAMP(3),
    "statusSyncWarnings" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderExternalMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceProvider" TEXT NOT NULL DEFAULT 'BLING',

    CONSTRAINT "OrderExternalMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "externalProductId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "document" TEXT,
    "slug" TEXT,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "blingLimit" INTEGER NOT NULL,
    "operationLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "features" JSONB,
    "maxBlingConnections" INTEGER NOT NULL DEFAULT 1,
    "maxMonthlyOperations" INTEGER NOT NULL DEFAULT 1000,
    "maxUsers" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT,
    "ean" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "ncm" TEXT,
    "cest" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "blockedFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attributes" JSONB,
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "depth" DECIMAL(10,3),
    "enrichmentStatus" TEXT NOT NULL DEFAULT 'IMPORTED',
    "height" DECIMAL(10,3),
    "source" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
    "weight" DECIMAL(10,3),
    "width" DECIMAL(10,3),
    "grossWeight" DECIMAL(10,3),
    "dimensionUnit" "ProductDimensionUnit",
    "condition" "ProductCondition",
    "format" "ProductFormat",
    "productType" "ProductType",
    "commercialStatus" "ProductCommercialStatus",
    "productionType" "ProductProductionType",
    "expirationDate" DATE,
    "freeShipping" BOOLEAN,
    "volumes" INTEGER,
    "itemsPerBox" DECIMAL(10,3),
    "packagingGtin" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAISuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "aiJobId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAISuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEnrichmentDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "generatedTitle" TEXT NOT NULL,
    "generatedDescription" TEXT NOT NULL,
    "technicalSpecs" JSONB NOT NULL,
    "dimensions" JSONB NOT NULL,
    "compatibility" JSONB NOT NULL,
    "advantages" JSONB NOT NULL,
    "packageContent" JSONB NOT NULL,
    "installationTutorial" TEXT NOT NULL,
    "careInstructions" TEXT NOT NULL,
    "sources" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEnrichmentDraft_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ProductExternalMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "lastExternalSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastDetailSyncAt" TIMESTAMP(3),

    CONSTRAINT "ProductExternalMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "markup" DECIMAL(8,4),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationQueue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PublicationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransferRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "enterpriseLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJobEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "safePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT,
    "productsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pricesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inventoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "imagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ordersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "direction" "SyncDirection" NOT NULL,
    "conflictStrategy" "ConflictStrategy" NOT NULL,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "preventNegativeStock" BOOLEAN NOT NULL DEFAULT true,
    "preserveBlockedFields" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "safePayload" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIJob_createdAt_idx" ON "AIJob"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AIJob_module_idx" ON "AIJob"("module" ASC);

-- CreateIndex
CREATE INDEX "AIJob_organizationId_idx" ON "AIJob"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "AIJob_productId_idx" ON "AIJob"("productId" ASC);

-- CreateIndex
CREATE INDEX "AIJob_status_idx" ON "AIJob"("status" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_riskLevel_idx" ON "AuditLog"("riskLevel" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_route_idx" ON "AuditLog"("route" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_status_idx" ON "AuditLog"("status" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_createdAt_idx" ON "BlingConnection"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_organizationId_idx" ON "BlingConnection"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_organizationId_isDefault_idx" ON "BlingConnection"("organizationId" ASC, "isDefault" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_organizationId_role_idx" ON "BlingConnection"("organizationId" ASC, "role" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_selectedAt_idx" ON "BlingConnection"("selectedAt" ASC);

-- CreateIndex
CREATE INDEX "BlingConnection_status_idx" ON "BlingConnection"("status" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_blingConnectionId_idx" ON "BlingProductImportDraft"("blingConnectionId" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_erpConnectionId_idx" ON "BlingProductImportDraft"("erpConnectionId" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_gtin_idx" ON "BlingProductImportDraft"("gtin" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_importStatus_idx" ON "BlingProductImportDraft"("importStatus" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_lastFetchedAt_idx" ON "BlingProductImportDraft"("lastFetchedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BlingProductImportDraft_organizationId_blingConnectionId_extern" ON "BlingProductImportDraft"("organizationId" ASC, "blingConnectionId" ASC, "externalId" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_organizationId_idx" ON "BlingProductImportDraft"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_sku_idx" ON "BlingProductImportDraft"("sku" ASC);

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_updatedAt_idx" ON "BlingProductImportDraft"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "BlingToken_connectionId_idx" ON "BlingToken"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "BlingToken_organizationId_connectionId_idx" ON "BlingToken"("organizationId" ASC, "connectionId" ASC);

-- CreateIndex
CREATE INDEX "BlingToken_organizationId_idx" ON "BlingToken"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ERPConnection_configStatus_idx" ON "ERPConnection"("configStatus" ASC);

-- CreateIndex
CREATE INDEX "ERPConnection_organizationId_idx" ON "ERPConnection"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ERPConnection_organizationId_provider_key" ON "ERPConnection"("organizationId" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "ERPConnection_provider_idx" ON "ERPConnection"("provider" ASC);

-- CreateIndex
CREATE INDEX "ERPConnection_status_idx" ON "ERPConnection"("status" ASC);

-- CreateIndex
CREATE INDEX "ERPConnection_updatedAt_idx" ON "ERPConnection"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_blingConnectionId_idx" ON "ErpSyncJob"("blingConnectionId" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_erpConnectionId_idx" ON "ErpSyncJob"("erpConnectionId" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_organizationId_idx" ON "ErpSyncJob"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_provider_idx" ON "ErpSyncJob"("provider" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_status_idx" ON "ErpSyncJob"("status" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_type_idx" ON "ErpSyncJob"("type" ASC);

-- CreateIndex
CREATE INDEX "ErpSyncJob_updatedAt_idx" ON "ErpSyncJob"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_approved_idx" ON "InternalGtinCatalog"("approved" ASC);

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_confidenceScore_idx" ON "InternalGtinCatalog"("confidenceScore" ASC);

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_gtin_idx" ON "InternalGtinCatalog"("gtin" ASC);

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_normalizedGtin_idx" ON "InternalGtinCatalog"("normalizedGtin" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InternalGtinCatalog_normalizedGtin_key" ON "InternalGtinCatalog"("normalizedGtin" ASC);

-- CreateIndex
CREATE INDEX "InternalGtinCatalog_updatedAt_idx" ON "InternalGtinCatalog"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "InventoryBalance_connectionId_idx" ON "InventoryBalance"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "InventoryBalance_organizationId_idx" ON "InventoryBalance"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_productId_connectionId_warehouse_key" ON "InventoryBalance"("productId" ASC, "connectionId" ASC, "warehouse" ASC);

-- CreateIndex
CREATE INDEX "InventoryBalance_status_idx" ON "InventoryBalance"("status" ASC);

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "InventoryMovement_organizationId_idx" ON "InventoryMovement"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_idx" ON "InventoryMovement"("productId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_lastSyncedAt_idx" ON "MarketplaceCategoryCatalog"("lastSyncedAt" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_name_idx" ON "MarketplaceCategoryCatalog"("name" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_parentMarketplaceCategoryId_idx" ON "MarketplaceCategoryCatalog"("parentMarketplaceCategoryId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_path_idx" ON "MarketplaceCategoryCatalog"("path" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_provider_idx" ON "MarketplaceCategoryCatalog"("provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategoryCatalog_provider_marketplaceCategoryId_key" ON "MarketplaceCategoryCatalog"("provider" ASC, "marketplaceCategoryId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryCatalog_siteId_idx" ON "MarketplaceCategoryCatalog"("siteId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_internalGtinCatalogId_idx" ON "MarketplaceCategoryMapping"("internalGtinCatalogId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_organizationId_idx" ON "MarketplaceCategoryMapping"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategoryMapping_organizationId_productId_provider_ke" ON "MarketplaceCategoryMapping"("organizationId" ASC, "productId" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_productId_idx" ON "MarketplaceCategoryMapping"("productId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_provider_idx" ON "MarketplaceCategoryMapping"("provider" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_status_idx" ON "MarketplaceCategoryMapping"("status" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceCategoryMapping_updatedAt_idx" ON "MarketplaceCategoryMapping"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceConnection_configStatus_idx" ON "MarketplaceConnection"("configStatus" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceConnection_organizationId_idx" ON "MarketplaceConnection"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_organizationId_provider_key" ON "MarketplaceConnection"("organizationId" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceConnection_provider_idx" ON "MarketplaceConnection"("provider" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceConnection_status_idx" ON "MarketplaceConnection"("status" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceConnection_updatedAt_idx" ON "MarketplaceConnection"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_attributeId_idx" ON "MarketplaceProductAttributeValue"("attributeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProductAttributeValue_mappingId_attributeId_key" ON "MarketplaceProductAttributeValue"("mappingId" ASC, "attributeId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_mappingId_idx" ON "MarketplaceProductAttributeValue"("mappingId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_marketplaceCategoryId_idx" ON "MarketplaceProductAttributeValue"("marketplaceCategoryId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_organizationId_idx" ON "MarketplaceProductAttributeValue"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_productId_idx" ON "MarketplaceProductAttributeValue"("productId" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_provider_idx" ON "MarketplaceProductAttributeValue"("provider" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_status_idx" ON "MarketplaceProductAttributeValue"("status" ASC);

-- CreateIndex
CREATE INDEX "MarketplaceProductAttributeValue_updatedAt_idx" ON "MarketplaceProductAttributeValue"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_expiresAt_idx" ON "MercadoLivreConnection"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_lastSyncAt_idx" ON "MercadoLivreConnection"("lastSyncAt" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_organizationId_configStatus_idx" ON "MercadoLivreConnection"("organizationId" ASC, "configStatus" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_organizationId_idx" ON "MercadoLivreConnection"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_organizationId_isDefault_idx" ON "MercadoLivreConnection"("organizationId" ASC, "isDefault" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_siteId_idx" ON "MercadoLivreConnection"("siteId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_status_idx" ON "MercadoLivreConnection"("status" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_updatedAt_idx" ON "MercadoLivreConnection"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreConnection_userId_idx" ON "MercadoLivreConnection"("userId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_categoryId_idx" ON "MercadoLivreListingCache"("categoryId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_gtin_idx" ON "MercadoLivreListingCache"("gtin" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_lastSyncedAt_idx" ON "MercadoLivreListingCache"("lastSyncedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_externalItemI" ON "MercadoLivreListingCache"("mercadoLivreConnectionId" ASC, "externalItemId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_idx" ON "MercadoLivreListingCache"("mercadoLivreConnectionId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_organizationId_idx" ON "MercadoLivreListingCache"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_organizationId_mercadoLivreConnectionI" ON "MercadoLivreListingCache"("organizationId" ASC, "mercadoLivreConnectionId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_sku_idx" ON "MercadoLivreListingCache"("sku" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_status_idx" ON "MercadoLivreListingCache"("status" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreListingCache_title_idx" ON "MercadoLivreListingCache"("title" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_createdAt_idx" ON "MercadoLivreReferenceImport"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_externalItemId_idx" ON "MercadoLivreReferenceImport"("externalItemId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_organizationId_externalItemId_idx" ON "MercadoLivreReferenceImport"("organizationId" ASC, "externalItemId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_organizationId_idx" ON "MercadoLivreReferenceImport"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_productId_idx" ON "MercadoLivreReferenceImport"("productId" ASC);

-- CreateIndex
CREATE INDEX "MercadoLivreReferenceImport_status_idx" ON "MercadoLivreReferenceImport"("status" ASC);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status" ASC);

-- CreateIndex
CREATE INDEX "OAuthState_createdAt_idx" ON "OAuthState"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "OAuthState_organizationId_idx" ON "OAuthState"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "OAuthState_provider_idx" ON "OAuthState"("provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash" ASC);

-- CreateIndex
CREATE INDEX "OAuthState_userId_idx" ON "OAuthState"("userId" ASC);

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Order_externalOrderId_idx" ON "Order"("externalOrderId" ASC);

-- CreateIndex
CREATE INDEX "Order_externalStatusCode_idx" ON "Order"("externalStatusCode" ASC);

-- CreateIndex
CREATE INDEX "Order_invoiceStatus_idx" ON "Order"("invoiceStatus" ASC);

-- CreateIndex
CREATE INDEX "Order_orderSituationId_idx" ON "Order"("orderSituationId" ASC);

-- CreateIndex
CREATE INDEX "Order_orderedAt_idx" ON "Order"("orderedAt" ASC);

-- CreateIndex
CREATE INDEX "Order_organizationId_idx" ON "Order"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_number_key" ON "Order"("organizationId" ASC, "number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_sourceProvider_sourceConnectionId_external" ON "Order"("organizationId" ASC, "sourceProvider" ASC, "sourceConnectionId" ASC, "externalOrderId" ASC);

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus" ASC);

-- CreateIndex
CREATE INDEX "Order_shippingStatus_idx" ON "Order"("shippingStatus" ASC);

-- CreateIndex
CREATE INDEX "Order_sourceConnectionId_idx" ON "Order"("sourceConnectionId" ASC);

-- CreateIndex
CREATE INDEX "Order_sourceProvider_idx" ON "Order"("sourceProvider" ASC);

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrderExternalMapping_connectionId_externalOrderId_key" ON "OrderExternalMapping"("connectionId" ASC, "externalOrderId" ASC);

-- CreateIndex
CREATE INDEX "OrderExternalMapping_connectionId_idx" ON "OrderExternalMapping"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "OrderExternalMapping_externalOrderId_idx" ON "OrderExternalMapping"("externalOrderId" ASC);

-- CreateIndex
CREATE INDEX "OrderExternalMapping_organizationId_idx" ON "OrderExternalMapping"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrderExternalMapping_organizationId_sourceProvider_connectionId" ON "OrderExternalMapping"("organizationId" ASC, "sourceProvider" ASC, "connectionId" ASC, "externalOrderId" ASC);

-- CreateIndex
CREATE INDEX "OrderExternalMapping_sourceProvider_idx" ON "OrderExternalMapping"("sourceProvider" ASC);

-- CreateIndex
CREATE INDEX "OrderItem_externalProductId_idx" ON "OrderItem"("externalProductId" ASC);

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId" ASC);

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_idx" ON "OrderItem"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId" ASC);

-- CreateIndex
CREATE INDEX "OrderItem_sku_idx" ON "OrderItem"("sku" ASC);

-- CreateIndex
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug" ASC);

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status" ASC);

-- CreateIndex
CREATE INDEX "OrganizationUser_organizationId_idx" ON "OrganizationUser"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "OrganizationUser_role_idx" ON "OrganizationUser"("role" ASC);

-- CreateIndex
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code" ASC);

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Product_ean_idx" ON "Product"("ean" ASC);

-- CreateIndex
CREATE INDEX "Product_enrichmentStatus_idx" ON "Product"("enrichmentStatus" ASC);

-- CreateIndex
CREATE INDEX "Product_organizationId_idx" ON "Product"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId" ASC, "sku" ASC);

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku" ASC);

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status" ASC);

-- CreateIndex
CREATE INDEX "Product_syncStatus_idx" ON "Product"("syncStatus" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_aiJobId_idx" ON "ProductAISuggestion"("aiJobId" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_createdAt_idx" ON "ProductAISuggestion"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_organizationId_idx" ON "ProductAISuggestion"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_productId_idx" ON "ProductAISuggestion"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_status_idx" ON "ProductAISuggestion"("status" ASC);

-- CreateIndex
CREATE INDEX "ProductAISuggestion_type_idx" ON "ProductAISuggestion"("type" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentDraft_organizationId_idx" ON "ProductEnrichmentDraft"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductEnrichmentDraft_organizationId_productId_key" ON "ProductEnrichmentDraft"("organizationId" ASC, "productId" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentDraft_productId_idx" ON "ProductEnrichmentDraft"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentDraft_status_idx" ON "ProductEnrichmentDraft"("status" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentDraft_updatedAt_idx" ON "ProductEnrichmentDraft"("updatedAt" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_compatibilityLevel_idx" ON "ProductEnrichmentHistory"("compatibilityLevel" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_createdAt_idx" ON "ProductEnrichmentHistory"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_organizationId_idx" ON "ProductEnrichmentHistory"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_productId_idx" ON "ProductEnrichmentHistory"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_sourceExternalId_idx" ON "ProductEnrichmentHistory"("sourceExternalId" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_sourceProvider_idx" ON "ProductEnrichmentHistory"("sourceProvider" ASC);

-- CreateIndex
CREATE INDEX "ProductEnrichmentHistory_userId_idx" ON "ProductEnrichmentHistory"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductExternalMapping_connectionId_externalProductId_key" ON "ProductExternalMapping"("connectionId" ASC, "externalProductId" ASC);

-- CreateIndex
CREATE INDEX "ProductExternalMapping_connectionId_idx" ON "ProductExternalMapping"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "ProductExternalMapping_externalProductId_idx" ON "ProductExternalMapping"("externalProductId" ASC);

-- CreateIndex
CREATE INDEX "ProductExternalMapping_organizationId_idx" ON "ProductExternalMapping"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductImage_organizationId_idx" ON "ProductImage"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductPrice_organizationId_idx" ON "ProductPrice"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductPrice_productId_idx" ON "ProductPrice"("productId" ASC);

-- CreateIndex
CREATE INDEX "ProductPrice_status_idx" ON "ProductPrice"("status" ASC);

-- CreateIndex
CREATE INDEX "ProductPriceHistory_createdAt_idx" ON "ProductPriceHistory"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "ProductPriceHistory_organizationId_idx" ON "ProductPriceHistory"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_idx" ON "ProductPriceHistory"("productId" ASC);

-- CreateIndex
CREATE INDEX "PublicationQueue_createdAt_idx" ON "PublicationQueue"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "PublicationQueue_organizationId_idx" ON "PublicationQueue"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "PublicationQueue_status_idx" ON "PublicationQueue"("status" ASC);

-- CreateIndex
CREATE INDEX "StockTransferRule_organizationId_idx" ON "StockTransferRule"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "StockTransferRun_organizationId_idx" ON "StockTransferRun"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "StockTransferRun_status_idx" ON "StockTransferRun"("status" ASC);

-- CreateIndex
CREATE INDEX "Subscription_organizationId_idx" ON "Subscription"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId" ASC);

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status" ASC);

-- CreateIndex
CREATE INDEX "SyncJob_connectionId_idx" ON "SyncJob"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "SyncJob_createdAt_idx" ON "SyncJob"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "SyncJob_organizationId_idx" ON "SyncJob"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status" ASC);

-- CreateIndex
CREATE INDEX "SyncJobEvent_createdAt_idx" ON "SyncJobEvent"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "SyncJobEvent_organizationId_idx" ON "SyncJobEvent"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "SyncJobEvent_syncJobId_idx" ON "SyncJobEvent"("syncJobId" ASC);

-- CreateIndex
CREATE INDEX "SyncRule_connectionId_idx" ON "SyncRule"("connectionId" ASC);

-- CreateIndex
CREATE INDEX "SyncRule_organizationId_idx" ON "SyncRule"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "UsageCounter_metric_idx" ON "UsageCounter"("metric" ASC);

-- CreateIndex
CREATE INDEX "UsageCounter_organizationId_idx" ON "UsageCounter"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_organizationId_metric_periodStart_periodEnd_key" ON "UsageCounter"("organizationId" ASC, "metric" ASC, "periodStart" ASC, "periodEnd" ASC);

-- CreateIndex
CREATE INDEX "UsageCounter_periodStart_idx" ON "UsageCounter"("periodStart" ASC);

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status" ASC);

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_blingConnectionId_idx" ON "UserIntegrationContextPreference"("blingConnectionId" ASC);

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_mode_idx" ON "UserIntegrationContextPreference"("mode" ASC);

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_organizationId_idx" ON "UserIntegrationContextPreference"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegrationContextPreference_organizationId_userId_key" ON "UserIntegrationContextPreference"("organizationId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_provider_idx" ON "UserIntegrationContextPreference"("provider" ASC);

-- CreateIndex
CREATE INDEX "UserIntegrationContextPreference_userId_idx" ON "UserIntegrationContextPreference"("userId" ASC);

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_idx" ON "WebhookEvent"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status" ASC);

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingConnection" ADD CONSTRAINT "BlingConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingToken" ADD CONSTRAINT "BlingToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERPConnection" ADD CONSTRAINT "ERPConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_internalGtinCatalogId_fkey" FOREIGN KEY ("internalGtinCatalogId") REFERENCES "InternalGtinCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceCategoryMapping" ADD CONSTRAINT "MarketplaceCategoryMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceConnection" ADD CONSTRAINT "MarketplaceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "MarketplaceCategoryMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceProductAttributeValue" ADD CONSTRAINT "MarketplaceProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreConnection" ADD CONSTRAINT "MercadoLivreConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingCache" ADD CONSTRAINT "MercadoLivreListingCache_mercadoLivreConnectionId_fkey" FOREIGN KEY ("mercadoLivreConnectionId") REFERENCES "MercadoLivreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingCache" ADD CONSTRAINT "MercadoLivreListingCache_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreReferenceImport" ADD CONSTRAINT "MercadoLivreReferenceImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreReferenceImport" ADD CONSTRAINT "MercadoLivreReferenceImport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderExternalMapping" ADD CONSTRAINT "OrderExternalMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderExternalMapping" ADD CONSTRAINT "OrderExternalMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentDraft" ADD CONSTRAINT "ProductEnrichmentDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentDraft" ADD CONSTRAINT "ProductEnrichmentDraft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEnrichmentHistory" ADD CONSTRAINT "ProductEnrichmentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExternalMapping" ADD CONSTRAINT "ProductExternalMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExternalMapping" ADD CONSTRAINT "ProductExternalMapping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationQueue" ADD CONSTRAINT "PublicationQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferRule" ADD CONSTRAINT "StockTransferRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferRun" ADD CONSTRAINT "StockTransferRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJobEvent" ADD CONSTRAINT "SyncJobEvent_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRule" ADD CONSTRAINT "SyncRule_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRule" ADD CONSTRAINT "SyncRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_blingConnectionId_fkey" FOREIGN KEY ("blingConnectionId") REFERENCES "BlingConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationContextPreference" ADD CONSTRAINT "UserIntegrationContextPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
