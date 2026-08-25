-- Add nullable local-only fields for read-only Bling order status synchronization.
ALTER TABLE "Order"
  ADD COLUMN "externalStatusCode" TEXT,
  ADD COLUMN "externalStatusName" TEXT,
  ADD COLUMN "orderSituationId" TEXT,
  ADD COLUMN "orderSituationName" TEXT,
  ADD COLUMN "invoiceStatus" TEXT,
  ADD COLUMN "invoiceNumber" TEXT,
  ADD COLUMN "invoiceKey" TEXT,
  ADD COLUMN "invoiceExternalId" TEXT,
  ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3),
  ADD COLUMN "lastStatusSyncAt" TIMESTAMP(3),
  ADD COLUMN "statusSyncWarnings" JSONB;

CREATE INDEX "Order_externalStatusCode_idx" ON "Order"("externalStatusCode");
CREATE INDEX "Order_orderSituationId_idx" ON "Order"("orderSituationId");
CREATE INDEX "Order_invoiceStatus_idx" ON "Order"("invoiceStatus");
