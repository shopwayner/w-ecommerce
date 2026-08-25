-- Expand local orders to support account context and future direct marketplace channels.
-- This is additive and preserves existing orders.

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "orderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "sourceConnectionId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "customerDocument" TEXT,
  ADD COLUMN IF NOT EXISTS "customerEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS "orderedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "importedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rawJson" JSONB;

UPDATE "Order"
SET
  "orderNumber" = COALESCE("orderNumber", "number"),
  "totalAmount" = CASE WHEN "totalAmount" = 0 THEN "total" ELSE "totalAmount" END,
  "orderedAt" = COALESCE("orderedAt", "createdAt")
WHERE "orderNumber" IS NULL
   OR "totalAmount" = 0
   OR "orderedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_sourceProvider_idx" ON "Order"("sourceProvider");
CREATE INDEX IF NOT EXISTS "Order_sourceConnectionId_idx" ON "Order"("sourceConnectionId");
CREATE INDEX IF NOT EXISTS "Order_externalOrderId_idx" ON "Order"("externalOrderId");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order"("paymentStatus");
CREATE INDEX IF NOT EXISTS "Order_shippingStatus_idx" ON "Order"("shippingStatus");
CREATE INDEX IF NOT EXISTS "Order_orderedAt_idx" ON "Order"("orderedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Order_organizationId_sourceProvider_sourceConnectionId_externalOrderId_key"
  ON "Order"("organizationId", "sourceProvider", "sourceConnectionId", "externalOrderId");

ALTER TABLE "OrderItem"
  ALTER COLUMN "productId" DROP NOT NULL,
  ALTER COLUMN "sku" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "externalProductId" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rawJson" JSONB,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "OrderItem"
SET
  "name" = COALESCE(NULLIF("name", ''), "sku", 'Item sem nome'),
  "totalPrice" = CASE WHEN "totalPrice" = 0 THEN "unitPrice" * "quantity" ELSE "totalPrice" END
WHERE "name" = ''
   OR "totalPrice" = 0;

CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX IF NOT EXISTS "OrderItem_externalProductId_idx" ON "OrderItem"("externalProductId");

ALTER TABLE "OrderExternalMapping"
  ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT NOT NULL DEFAULT 'BLING';

CREATE INDEX IF NOT EXISTS "OrderExternalMapping_sourceProvider_idx" ON "OrderExternalMapping"("sourceProvider");

CREATE UNIQUE INDEX IF NOT EXISTS "OrderExternalMapping_organizationId_sourceProvider_connectionId_externalOrderId_key"
  ON "OrderExternalMapping"("organizationId", "sourceProvider", "connectionId", "externalOrderId");

