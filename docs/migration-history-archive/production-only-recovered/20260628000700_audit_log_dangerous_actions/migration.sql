-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AuditRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "AuditLog"
  ALTER COLUMN "organizationId" DROP NOT NULL,
  ADD COLUMN "userEmail" TEXT,
  ADD COLUMN "userRole" TEXT,
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "route" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "confirmation" TEXT,
  ADD COLUMN "status" "AuditLogStatus" NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "riskLevel" "AuditRiskLevel" NOT NULL DEFAULT 'LOW',
  ADD COLUMN "summary" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_status_idx" ON "AuditLog"("status");

-- CreateIndex
CREATE INDEX "AuditLog_riskLevel_idx" ON "AuditLog"("riskLevel");

-- CreateIndex
CREATE INDEX "AuditLog_route_idx" ON "AuditLog"("route");
