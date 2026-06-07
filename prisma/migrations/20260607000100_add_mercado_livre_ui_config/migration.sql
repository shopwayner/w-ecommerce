ALTER TABLE "MercadoLivreConnection"
  ADD COLUMN "accountAlias" TEXT,
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "clientSecretEncrypted" TEXT,
  ADD COLUMN "redirectUri" TEXT,
  ADD COLUMN "taxRate" DECIMAL(5, 2),
  ADD COLUMN "orderImportStartDate" TIMESTAMP(3),
  ADD COLUMN "configStatus" TEXT NOT NULL DEFAULT 'MISSING',
  ALTER COLUMN "accessTokenEncrypted" DROP NOT NULL,
  ALTER COLUMN "refreshTokenEncrypted" DROP NOT NULL,
  ALTER COLUMN "expiresAt" DROP NOT NULL,
  ALTER COLUMN "connectedAt" DROP DEFAULT,
  ALTER COLUMN "connectedAt" DROP NOT NULL;

UPDATE "MercadoLivreConnection"
SET "configStatus" = 'READY'
WHERE "status" = 'ACTIVE';

CREATE INDEX "MercadoLivreConnection_organizationId_configStatus_idx" ON "MercadoLivreConnection"("organizationId", "configStatus");
