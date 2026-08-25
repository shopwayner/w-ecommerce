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

CREATE INDEX "ProductEnrichmentHistory_organizationId_idx" ON "ProductEnrichmentHistory"("organizationId");
CREATE INDEX "ProductEnrichmentHistory_productId_idx" ON "ProductEnrichmentHistory"("productId");
CREATE INDEX "ProductEnrichmentHistory_userId_idx" ON "ProductEnrichmentHistory"("userId");
CREATE INDEX "ProductEnrichmentHistory_sourceProvider_idx" ON "ProductEnrichmentHistory"("sourceProvider");
CREATE INDEX "ProductEnrichmentHistory_sourceExternalId_idx" ON "ProductEnrichmentHistory"("sourceExternalId");
CREATE INDEX "ProductEnrichmentHistory_compatibilityLevel_idx" ON "ProductEnrichmentHistory"("compatibilityLevel");
CREATE INDEX "ProductEnrichmentHistory_createdAt_idx" ON "ProductEnrichmentHistory"("createdAt");

ALTER TABLE "ProductEnrichmentHistory"
ADD CONSTRAINT "ProductEnrichmentHistory_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductEnrichmentHistory"
ADD CONSTRAINT "ProductEnrichmentHistory_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductEnrichmentHistory"
ADD CONSTRAINT "ProductEnrichmentHistory_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
