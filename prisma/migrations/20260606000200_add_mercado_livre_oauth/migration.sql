ALTER TYPE "OAuthProvider" ADD VALUE IF NOT EXISTS 'MERCADOLIVRE';

CREATE TABLE "MercadoLivreConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Mercado Livre',
    "siteId" TEXT NOT NULL DEFAULT 'MLB',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "externalUserId" TEXT,
    "tokenType" TEXT NOT NULL DEFAULT 'Bearer',
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastRefreshAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreConnection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MercadoLivreConnection_organizationId_idx" ON "MercadoLivreConnection"("organizationId");
CREATE INDEX "MercadoLivreConnection_userId_idx" ON "MercadoLivreConnection"("userId");
CREATE INDEX "MercadoLivreConnection_siteId_idx" ON "MercadoLivreConnection"("siteId");
CREATE INDEX "MercadoLivreConnection_status_idx" ON "MercadoLivreConnection"("status");
CREATE INDEX "MercadoLivreConnection_expiresAt_idx" ON "MercadoLivreConnection"("expiresAt");
CREATE INDEX "MercadoLivreConnection_updatedAt_idx" ON "MercadoLivreConnection"("updatedAt");

ALTER TABLE "MercadoLivreConnection" ADD CONSTRAINT "MercadoLivreConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
