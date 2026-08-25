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

-- CreateIndex
CREATE INDEX "AIJob_organizationId_idx" ON "AIJob"("organizationId");
CREATE INDEX "AIJob_productId_idx" ON "AIJob"("productId");
CREATE INDEX "AIJob_module_idx" ON "AIJob"("module");
CREATE INDEX "AIJob_status_idx" ON "AIJob"("status");
CREATE INDEX "AIJob_createdAt_idx" ON "AIJob"("createdAt");

-- CreateIndex
CREATE INDEX "ProductAISuggestion_organizationId_idx" ON "ProductAISuggestion"("organizationId");
CREATE INDEX "ProductAISuggestion_productId_idx" ON "ProductAISuggestion"("productId");
CREATE INDEX "ProductAISuggestion_aiJobId_idx" ON "ProductAISuggestion"("aiJobId");
CREATE INDEX "ProductAISuggestion_type_idx" ON "ProductAISuggestion"("type");
CREATE INDEX "ProductAISuggestion_status_idx" ON "ProductAISuggestion"("status");
CREATE INDEX "ProductAISuggestion_createdAt_idx" ON "ProductAISuggestion"("createdAt");

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAISuggestion" ADD CONSTRAINT "ProductAISuggestion_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
