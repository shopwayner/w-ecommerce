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

CREATE UNIQUE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_externalItemId_key" ON "MercadoLivreListingCache"("mercadoLivreConnectionId", "externalItemId");
CREATE INDEX "MercadoLivreListingCache_organizationId_idx" ON "MercadoLivreListingCache"("organizationId");
CREATE INDEX "MercadoLivreListingCache_mercadoLivreConnectionId_idx" ON "MercadoLivreListingCache"("mercadoLivreConnectionId");
CREATE INDEX "MercadoLivreListingCache_organizationId_mercadoLivreConnectionId_idx" ON "MercadoLivreListingCache"("organizationId", "mercadoLivreConnectionId");
CREATE INDEX "MercadoLivreListingCache_sku_idx" ON "MercadoLivreListingCache"("sku");
CREATE INDEX "MercadoLivreListingCache_gtin_idx" ON "MercadoLivreListingCache"("gtin");
CREATE INDEX "MercadoLivreListingCache_title_idx" ON "MercadoLivreListingCache"("title");
CREATE INDEX "MercadoLivreListingCache_categoryId_idx" ON "MercadoLivreListingCache"("categoryId");
CREATE INDEX "MercadoLivreListingCache_status_idx" ON "MercadoLivreListingCache"("status");
CREATE INDEX "MercadoLivreListingCache_lastSyncedAt_idx" ON "MercadoLivreListingCache"("lastSyncedAt");

ALTER TABLE "MercadoLivreListingCache"
ADD CONSTRAINT "MercadoLivreListingCache_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MercadoLivreListingCache"
ADD CONSTRAINT "MercadoLivreListingCache_mercadoLivreConnectionId_fkey"
FOREIGN KEY ("mercadoLivreConnectionId") REFERENCES "MercadoLivreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
