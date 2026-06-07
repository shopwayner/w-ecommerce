CREATE TYPE "MarketplaceProvider" AS ENUM (
  'MERCADOLIVRE',
  'MAGALU',
  'SHOPEE',
  'SHOPEE_ADS',
  'AMAZON',
  'SHEIN',
  'TIKTOK_SHOP'
);

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
  "taxRate" DECIMAL(5, 2),
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

CREATE UNIQUE INDEX "MarketplaceConnection_organizationId_provider_key" ON "MarketplaceConnection"("organizationId", "provider");
CREATE INDEX "MarketplaceConnection_organizationId_idx" ON "MarketplaceConnection"("organizationId");
CREATE INDEX "MarketplaceConnection_provider_idx" ON "MarketplaceConnection"("provider");
CREATE INDEX "MarketplaceConnection_status_idx" ON "MarketplaceConnection"("status");
CREATE INDEX "MarketplaceConnection_configStatus_idx" ON "MarketplaceConnection"("configStatus");
CREATE INDEX "MarketplaceConnection_updatedAt_idx" ON "MarketplaceConnection"("updatedAt");

ALTER TABLE "MarketplaceConnection" ADD CONSTRAINT "MarketplaceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
