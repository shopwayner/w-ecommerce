CREATE TYPE "ERPProvider" AS ENUM (
  'BLING',
  'OLIST',
  'OMIE',
  'CONTA_AZUL',
  'CUSTOM_API'
);

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
  "taxRate" DECIMAL(5, 2),
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

CREATE UNIQUE INDEX "ERPConnection_organizationId_provider_key" ON "ERPConnection"("organizationId", "provider");
CREATE INDEX "ERPConnection_organizationId_idx" ON "ERPConnection"("organizationId");
CREATE INDEX "ERPConnection_provider_idx" ON "ERPConnection"("provider");
CREATE INDEX "ERPConnection_status_idx" ON "ERPConnection"("status");
CREATE INDEX "ERPConnection_configStatus_idx" ON "ERPConnection"("configStatus");
CREATE INDEX "ERPConnection_updatedAt_idx" ON "ERPConnection"("updatedAt");

ALTER TABLE "ERPConnection" ADD CONSTRAINT "ERPConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
