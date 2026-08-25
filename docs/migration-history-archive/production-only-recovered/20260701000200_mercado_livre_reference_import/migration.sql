CREATE TABLE "MercadoLivreReferenceImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MERCADO_LIVRE',
    "externalItemId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "gtin" TEXT,
    "brand" TEXT,
    "partNumber" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "price" DECIMAL(12,2),
    "currencyId" TEXT,
    "permalink" TEXT,
    "thumbnail" TEXT,
    "picturesJson" JSONB,
    "attributesJson" JSONB,
    "rawSanitizedJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreReferenceImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MercadoLivreReferenceImport_organizationId_idx" ON "MercadoLivreReferenceImport"("organizationId");
CREATE INDEX "MercadoLivreReferenceImport_productId_idx" ON "MercadoLivreReferenceImport"("productId");
CREATE INDEX "MercadoLivreReferenceImport_externalItemId_idx" ON "MercadoLivreReferenceImport"("externalItemId");
CREATE INDEX "MercadoLivreReferenceImport_organizationId_externalItemId_idx" ON "MercadoLivreReferenceImport"("organizationId", "externalItemId");
CREATE INDEX "MercadoLivreReferenceImport_status_idx" ON "MercadoLivreReferenceImport"("status");
CREATE INDEX "MercadoLivreReferenceImport_createdAt_idx" ON "MercadoLivreReferenceImport"("createdAt");

ALTER TABLE "MercadoLivreReferenceImport"
ADD CONSTRAINT "MercadoLivreReferenceImport_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MercadoLivreReferenceImport"
ADD CONSTRAINT "MercadoLivreReferenceImport_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
