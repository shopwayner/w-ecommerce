ALTER TABLE "MercadoLivreConnection"
ADD COLUMN "sellerNickname" TEXT,
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastSyncAt" TIMESTAMP(3);

CREATE INDEX "MercadoLivreConnection_organizationId_isDefault_idx" ON "MercadoLivreConnection"("organizationId", "isDefault");
CREATE INDEX "MercadoLivreConnection_lastSyncAt_idx" ON "MercadoLivreConnection"("lastSyncAt");
