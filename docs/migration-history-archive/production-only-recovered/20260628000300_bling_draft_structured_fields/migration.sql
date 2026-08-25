ALTER TABLE "BlingProductImportDraft"
  ADD COLUMN "costPrice" DECIMAL(12, 2),
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "ncm" TEXT,
  ADD COLUMN "supplierName" TEXT,
  ADD COLUMN "supplierCode" TEXT,
  ADD COLUMN "weight" DECIMAL(10, 3),
  ADD COLUMN "height" DECIMAL(10, 3),
  ADD COLUMN "width" DECIMAL(10, 3),
  ADD COLUMN "depth" DECIMAL(10, 3);
