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

    CONSTRAINT "ErpSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErpSyncJob_organizationId_idx" ON "ErpSyncJob"("organizationId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_erpConnectionId_idx" ON "ErpSyncJob"("erpConnectionId");

-- CreateIndex
CREATE INDEX "ErpSyncJob_provider_idx" ON "ErpSyncJob"("provider");

-- CreateIndex
CREATE INDEX "ErpSyncJob_type_idx" ON "ErpSyncJob"("type");

-- CreateIndex
CREATE INDEX "ErpSyncJob_status_idx" ON "ErpSyncJob"("status");

-- CreateIndex
CREATE INDEX "ErpSyncJob_updatedAt_idx" ON "ErpSyncJob"("updatedAt");

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErpSyncJob" ADD CONSTRAINT "ErpSyncJob_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "ERPConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
