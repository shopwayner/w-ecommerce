-- CreateEnum
CREATE TYPE "ProductFormat" AS ENUM ('SIMPLE', 'VARIATION', 'COMPOSITION');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE', 'SERVICE_06_21_22');

-- CreateEnum
CREATE TYPE "ProductCommercialStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductProductionType" AS ENUM ('OWN', 'THIRD_PARTY');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "format" "ProductFormat",
ADD COLUMN "productType" "ProductType",
ADD COLUMN "commercialStatus" "ProductCommercialStatus",
ADD COLUMN "productionType" "ProductProductionType",
ADD COLUMN "expirationDate" DATE,
ADD COLUMN "freeShipping" BOOLEAN,
ADD COLUMN "volumes" INTEGER,
ADD COLUMN "itemsPerBox" DECIMAL(10,3),
ADD COLUMN "packagingGtin" TEXT;
