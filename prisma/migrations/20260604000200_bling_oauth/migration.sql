-- CreateEnum
CREATE TYPE "BlingEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('BLING');

-- AlterEnum
ALTER TYPE "ConnectionRole" ADD VALUE 'OTHER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ConnectionStatus" ADD VALUE 'DISCONNECTED';
ALTER TYPE "ConnectionStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "BlingConnection" ADD COLUMN     "environment" "BlingEnvironment" NOT NULL DEFAULT 'PRODUCTION',
ADD COLUMN     "externalCompanyDocument" TEXT,
ADD COLUMN     "externalCompanyId" TEXT,
ADD COLUMN     "externalCompanyName" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastTestAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "BlingToken" ADD COLUMN     "refreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "tokenType" TEXT NOT NULL DEFAULT 'Bearer';

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL DEFAULT 'BLING',
    "stateHash" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL,
    "connectionRole" "ConnectionRole" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthState_organizationId_idx" ON "OAuthState"("organizationId");

-- CreateIndex
CREATE INDEX "OAuthState_userId_idx" ON "OAuthState"("userId");

-- CreateIndex
CREATE INDEX "OAuthState_provider_idx" ON "OAuthState"("provider");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "OAuthState_createdAt_idx" ON "OAuthState"("createdAt");

-- CreateIndex
CREATE INDEX "BlingToken_organizationId_connectionId_idx" ON "BlingToken"("organizationId", "connectionId");

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

