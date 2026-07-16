CREATE TYPE "ProductCondition" AS ENUM ('UNSPECIFIED', 'NEW', 'USED');
CREATE TYPE "ProductDimensionUnit" AS ENUM ('METER', 'CENTIMETER', 'MILLIMETER');

ALTER TABLE "Product"
  ADD COLUMN "grossWeight" DECIMAL(10, 3),
  ADD COLUMN "dimensionUnit" "ProductDimensionUnit",
  ADD COLUMN "condition" "ProductCondition";

ALTER TABLE "ProductExternalMapping"
  ADD COLUMN "lastDetailSyncAt" TIMESTAMP(3);
