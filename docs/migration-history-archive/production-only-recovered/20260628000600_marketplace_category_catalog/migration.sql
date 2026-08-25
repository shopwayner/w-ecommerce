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

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceCategoryCatalog_provider_marketplaceCategoryId_key" ON "MarketplaceCategoryCatalog"("provider", "marketplaceCategoryId");

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
