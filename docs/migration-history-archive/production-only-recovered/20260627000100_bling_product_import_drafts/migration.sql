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

    CONSTRAINT "BlingProductImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlingProductImportDraft_organizationId_externalId_key" ON "BlingProductImportDraft"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_organizationId_idx" ON "BlingProductImportDraft"("organizationId");

-- CreateIndex
CREATE INDEX "BlingProductImportDraft_erpConnectionId_idx" ON "BlingProductImportDraft"("erpConnectionId");

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

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlingProductImportDraft" ADD CONSTRAINT "BlingProductImportDraft_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
