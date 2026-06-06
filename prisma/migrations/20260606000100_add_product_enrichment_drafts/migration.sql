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

CREATE UNIQUE INDEX "ProductEnrichmentDraft_organizationId_productId_key" ON "ProductEnrichmentDraft"("organizationId", "productId");
CREATE INDEX "ProductEnrichmentDraft_organizationId_idx" ON "ProductEnrichmentDraft"("organizationId");
CREATE INDEX "ProductEnrichmentDraft_productId_idx" ON "ProductEnrichmentDraft"("productId");
CREATE INDEX "ProductEnrichmentDraft_status_idx" ON "ProductEnrichmentDraft"("status");
CREATE INDEX "ProductEnrichmentDraft_updatedAt_idx" ON "ProductEnrichmentDraft"("updatedAt");

ALTER TABLE "ProductEnrichmentDraft" ADD CONSTRAINT "ProductEnrichmentDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductEnrichmentDraft" ADD CONSTRAINT "ProductEnrichmentDraft_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
