import "server-only";

import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/server";
import { hasSystemPermission } from "@/lib/auth/system-superuser";
import { normalizeProductBrand } from "@/lib/product-brand";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import {
  readBlingProductConnectionAttributes,
  readCanonicalBlingStatusFromAttributes
} from "@/lib/services/bling-product-import-service";

function getMetadata(blockedFields: unknown) {
  return blockedFields && typeof blockedFields === "object" && !Array.isArray(blockedFields)
    ? (blockedFields as Record<string, unknown>)
    : {};
}

function getAttributes(attributes: unknown) {
  return attributes && typeof attributes === "object" && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : {};
}

function getStringAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const productDetailsInclude = (organizationId: string, blingConnectionId: string | null) => ({
  prices: {
    where: { organizationId },
    take: 1,
    orderBy: { createdAt: "desc" as const }
  },
  inventory: {
    where: {
      organizationId,
      ...(blingConnectionId ? { connectionId: blingConnectionId } : {})
    }
  },
  images: {
    where: { organizationId },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }]
  },
  enrichmentDrafts: {
    where: { organizationId },
    take: 1,
    orderBy: { updatedAt: "desc" as const }
  },
  mappings: {
    where: {
      organizationId,
      ...(blingConnectionId ? { connectionId: blingConnectionId } : {})
    },
    take: 1,
    orderBy: { updatedAt: "desc" as const },
    include: {
      connection: {
        select: {
          id: true,
          name: true,
          status: true,
          isDefault: true,
          externalCompanyName: true,
          externalCompanyDocument: true,
          externalAccountId: true
        }
      }
    }
  },
  marketplaceCategoryMappings: {
    where: { organizationId, provider: "MERCADO_LIVRE" as const },
    take: 1,
    orderBy: { updatedAt: "desc" as const },
    include: {
      productAttributeValues: {
        select: {
          attributeId: true,
          value: true,
          status: true
        }
      }
    }
  }
}) satisfies Prisma.ProductInclude;

type ProductDetailsRecord = Prisma.ProductGetPayload<{
  include: ReturnType<typeof productDetailsInclude>;
}>;

export function isValidProductDetailsId(value: string) {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function serializeProductDetails(product: ProductDetailsRecord) {
  const metadata = getMetadata(product.blockedFields);
  const attributes = getAttributes(product.attributes);
  const inventoryStock = product.inventory.reduce(
    (total, item) => total + item.physicalQuantity - item.reservedQuantity,
    0
  );
  const stockOverride = typeof metadata.stockOverride === "number" ? metadata.stockOverride : null;
  const currentPrice = product.prices[0];
  const blingMapping = product.mappings[0];
  const blingAttributes = readBlingProductConnectionAttributes(
    attributes,
    blingMapping?.connectionId
  );
  const brand = normalizeProductBrand(product.brand);
  const blingAccountName =
    blingMapping?.connection.name ||
    blingMapping?.connection.externalCompanyName ||
    blingMapping?.connection.externalCompanyDocument ||
    blingMapping?.connection.externalAccountId ||
    null;

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    ean: product.ean,
    category: product.category,
    brand,
    ncm: product.ncm,
    origin:
      typeof metadata.origin === "string"
        ? metadata.origin
        : getStringAttribute(blingAttributes, "origin") ?? product.source,
    unit:
      typeof metadata.unit === "string"
        ? metadata.unit
        : getStringAttribute(blingAttributes, "unit")
          ?? (typeof attributes.unit === "string" ? attributes.unit : null),
    description: product.description,
    imageUrl: product.images[0]?.url ?? null,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      position: image.position
    })),
    hasEnrichmentDraft: product.enrichmentDrafts.length > 0,
    status: product.status,
    enrichmentStatus: product.enrichmentStatus,
    syncStatus: product.syncStatus,
    source: product.source,
    externalId: blingMapping?.externalProductId ?? getStringAttribute(attributes, "externalId"),
    externalProductId: blingMapping?.externalProductId ?? getStringAttribute(attributes, "externalId"),
    blingAccount: blingMapping
      ? {
          blingAccountId: blingMapping.connectionId,
          blingAccountName,
          displayName: blingAccountName,
          blingAccountShortId: blingMapping.connectionId.slice(-8),
          isActiveDefault: blingMapping.connection.isDefault,
          externalProductId: blingMapping.externalProductId,
          status: blingMapping.connection.status
        }
      : null,
    blingStatus: readCanonicalBlingStatusFromAttributes(
      attributes,
      blingMapping?.connectionId
    ),
    marketplaceCategories: product.marketplaceCategoryMappings.map((mapping) => ({
      provider: mapping.provider,
      status: mapping.status,
      marketplaceCategoryId: mapping.marketplaceCategoryId,
      marketplaceCategoryName: mapping.marketplaceCategoryName,
      marketplaceCategoryPath: mapping.marketplaceCategoryPath,
      confidenceScore: mapping.confidenceScore,
      requiredAttributes: mapping.requiredAttributes,
      attributeValues: mapping.productAttributeValues.map((value) => ({
        attributeId: value.attributeId,
        value: value.value,
        status: value.status
      }))
    })),
    confidenceScore: product.confidenceScore,
    weight: product.weight?.toString() ?? null,
    grossWeight: product.grossWeight?.toString() ?? null,
    height: product.height?.toString() ?? null,
    width: product.width?.toString() ?? null,
    depth: product.depth?.toString() ?? null,
    dimensionUnit: product.dimensionUnit,
    condition: product.condition,
    format: product.format,
    productType: product.productType,
    commercialStatus: product.commercialStatus,
    productionType: product.productionType,
    expirationDate: product.expirationDate?.toISOString().slice(0, 10) ?? null,
    freeShipping: product.freeShipping,
    volumes: product.volumes,
    itemsPerBox: product.itemsPerBox?.toString() ?? null,
    packagingGtin: product.packagingGtin,
    attributes: product.attributes,
    displayValue: typeof metadata.displayValue === "string" ? metadata.displayValue : null,
    salePriceDisplay:
      typeof metadata.salePriceDisplay === "string"
        ? metadata.salePriceDisplay
        : currentPrice?.salePrice.toString() ?? null,
    costPrice: currentPrice?.costPrice.toString() ?? "0",
    costPriceDisplay: currentPrice?.costPrice.toString() ?? null,
    price: currentPrice?.salePrice.toString() ?? "0",
    stock: product.inventory.length ? inventoryStock : stockOverride ?? inventoryStock,
    updatedAt: product.updatedAt.toISOString()
  };
}

export function toProductDetailsInitialProduct(
  data: ReturnType<typeof serializeProductDetails>
) {
  return {
    id: data.id,
    name: data.name,
    sku: data.sku,
    ean: data.ean,
    description: data.description,
    category: data.category,
    brand: data.brand,
    origin: data.origin,
    unit: data.unit,
    status: data.status,
    source: data.source,
    displayValue: data.displayValue,
    salePriceDisplay: data.salePriceDisplay,
    costPriceDisplay: data.costPriceDisplay,
    imageUrl: data.imageUrl,
    images: data.images,
    weight: data.weight,
    grossWeight: data.grossWeight,
    height: data.height,
    width: data.width,
    depth: data.depth,
    dimensionUnit: data.dimensionUnit,
    condition: data.condition,
    format: data.format,
    productType: data.productType,
    commercialStatus: data.commercialStatus,
    productionType: data.productionType,
    expirationDate: data.expirationDate,
    freeShipping: data.freeShipping,
    volumes: data.volumes,
    itemsPerBox: data.itemsPerBox,
    packagingGtin: data.packagingGtin,
    attributes: data.attributes,
    blingStatus: data.blingStatus,
    blingAccount: data.blingAccount
      ? {
          blingAccountId: data.blingAccount.blingAccountId,
          blingAccountName: data.blingAccount.blingAccountName,
          displayName: data.blingAccount.displayName
        }
      : null,
    price: data.price,
    stock: data.stock,
    updatedAt: data.updatedAt
  };
}

export async function findProductDetails(input: {
  productId: string;
  organizationId: string;
  blingConnectionId: string | null;
}) {
  const product = await prisma.product.findFirst({
    where: {
      id: input.productId,
      organizationId: input.organizationId
    },
    include: productDetailsInclude(input.organizationId, input.blingConnectionId)
  });

  return product ? serializeProductDetails(product) : null;
}

export async function loadProductDetails(authContext: TenantContext, productId: string) {
  const accountContext = await getUserAccountContext(authContext);
  const blingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;
  const data = await findProductDetails({
    productId,
    organizationId: authContext.organizationId,
    blingConnectionId
  });

  if (!data) return null;

  return {
    data,
    permissions: {
      canEdit: hasSystemPermission(authContext, "products:write")
    },
    accountContext
  };
}
