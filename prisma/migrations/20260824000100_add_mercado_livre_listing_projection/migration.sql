-- CreateEnum
CREATE TYPE "MercadoLivreListingProjectionStateStatus" AS ENUM ('NEVER_SYNCED', 'SYNCING', 'COMPLETE', 'ERROR');

-- CreateEnum
CREATE TYPE "MercadoLivreListingProjectionGenerationStatus" AS ENUM ('BUILDING', 'COMPLETE', 'ERROR');

-- CreateTable
CREATE TABLE "MercadoLivreListingProjectionState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceConnectionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "MercadoLivreListingProjectionStateStatus" NOT NULL DEFAULT 'NEVER_SYNCED',
    "activeGenerationId" TEXT,
    "lastAttemptStartedAt" TIMESTAMP(3),
    "lastAttemptFinishedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(80),
    "lastErrorSummary" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreListingProjectionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoLivreListingProjectionGeneration" (
    "id" TEXT NOT NULL,
    "projectionStateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceConnectionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "MercadoLivreListingProjectionGenerationStatus" NOT NULL DEFAULT 'BUILDING',
    "expectedTotal" INTEGER,
    "storedTotal" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" VARCHAR(80),
    "errorSummary" VARCHAR(240),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreListingProjectionGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoLivreListingProjection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceConnectionId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "mlbId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "gtin" TEXT,
    "status" TEXT NOT NULL,
    "subStatus" JSONB,
    "health" DECIMAL(5,4),
    "listingTypeId" TEXT NOT NULL,
    "availableQuantity" INTEGER,
    "price" DECIMAL(12,2),
    "currencyId" TEXT,
    "thumbnail" TEXT,
    "categoryId" TEXT,
    "permalink" TEXT,
    "dateCreated" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreListingProjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ml_proj_state_active_generation_key" ON "MercadoLivreListingProjectionState"("activeGenerationId");

-- CreateIndex
CREATE INDEX "ml_proj_state_connection_idx" ON "MercadoLivreListingProjectionState"("marketplaceConnectionId");

-- CreateIndex
CREATE INDEX "ml_proj_state_status_idx" ON "MercadoLivreListingProjectionState"("status");

-- CreateIndex
CREATE INDEX "ml_proj_state_last_success_idx" ON "MercadoLivreListingProjectionState"("lastSuccessfulSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "ml_proj_state_tenant_connection_seller_key" ON "MercadoLivreListingProjectionState"("organizationId", "marketplaceConnectionId", "sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "ml_proj_state_owner_key" ON "MercadoLivreListingProjectionState"("id", "organizationId", "marketplaceConnectionId", "sellerId");

-- CreateIndex
CREATE INDEX "ml_proj_generation_state_status_idx" ON "MercadoLivreListingProjectionGeneration"("projectionStateId", "status");

-- CreateIndex
CREATE INDEX "ml_proj_generation_tenant_status_idx" ON "MercadoLivreListingProjectionGeneration"("organizationId", "marketplaceConnectionId", "sellerId", "status");

-- CreateIndex
CREATE INDEX "ml_proj_generation_started_idx" ON "MercadoLivreListingProjectionGeneration"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ml_proj_generation_owner_key" ON "MercadoLivreListingProjectionGeneration"("id", "organizationId", "marketplaceConnectionId", "sellerId");

-- CreateIndex
CREATE INDEX "ml_proj_tenant_generation_idx" ON "MercadoLivreListingProjection"("organizationId", "marketplaceConnectionId", "sellerId", "generationId");

-- CreateIndex
CREATE INDEX "ml_proj_generation_status_idx" ON "MercadoLivreListingProjection"("generationId", "status");

-- CreateIndex
CREATE INDEX "ml_proj_generation_type_idx" ON "MercadoLivreListingProjection"("generationId", "listingTypeId");

-- CreateIndex
CREATE INDEX "ml_proj_generation_stock_idx" ON "MercadoLivreListingProjection"("generationId", "availableQuantity");

-- CreateIndex
CREATE INDEX "ml_proj_generation_sku_idx" ON "MercadoLivreListingProjection"("generationId", "sku");

-- CreateIndex
CREATE INDEX "ml_proj_generation_gtin_idx" ON "MercadoLivreListingProjection"("generationId", "gtin");

-- CreateIndex
CREATE INDEX "ml_proj_generation_remote_updated_idx" ON "MercadoLivreListingProjection"("generationId", "remoteUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ml_proj_generation_mlb_key" ON "MercadoLivreListingProjection"("generationId", "mlbId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_connection_tenant_owner_key" ON "MarketplaceConnection"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "MercadoLivreListingProjectionState" ADD CONSTRAINT "MercadoLivreListingProjectionState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingProjectionState" ADD CONSTRAINT "MercadoLivreListingProjectionState_marketplaceConnectionId_fkey" FOREIGN KEY ("marketplaceConnectionId", "organizationId") REFERENCES "MarketplaceConnection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingProjectionState" ADD CONSTRAINT "MercadoLivreListingProjectionState_activeGenerationId_fkey" FOREIGN KEY ("activeGenerationId") REFERENCES "MercadoLivreListingProjectionGeneration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingProjectionGeneration" ADD CONSTRAINT "MercadoLivreListingProjectionGeneration_projectionStateId__fkey" FOREIGN KEY ("projectionStateId", "organizationId", "marketplaceConnectionId", "sellerId") REFERENCES "MercadoLivreListingProjectionState"("id", "organizationId", "marketplaceConnectionId", "sellerId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MercadoLivreListingProjection" ADD CONSTRAINT "MercadoLivreListingProjection_generationId_organizationId__fkey" FOREIGN KEY ("generationId", "organizationId", "marketplaceConnectionId", "sellerId") REFERENCES "MercadoLivreListingProjectionGeneration"("id", "organizationId", "marketplaceConnectionId", "sellerId") ON DELETE CASCADE ON UPDATE CASCADE;
