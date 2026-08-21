import "server-only";

import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/server";
import { prisma } from "@/lib/prisma";
import { parseProductListFilters } from "@/lib/product-list-filters";
import {
  countProductList,
  findProductListPageIds,
  loadProductListCatalogMetadata,
  parseProductListPagination,
  type ProductListQueryInput
} from "@/lib/product-list-query";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import {
  readBlingProductConnectionAttributes,
  readBlingProductMarketplaceStores,
  readCanonicalBlingStatusFromAttributes
} from "@/lib/services/bling-product-import-service";

const productListSelect = {
  id: true,
  name: true,
  sku: true,
  ean: true,
  category: true,
  brand: true,
  source: true,
  status: true,
  attributes: true,
  blockedFields: true,
  updatedAt: true,
  prices: {
    take: 1,
    orderBy: { createdAt: "desc" },
    select: { salePrice: true, costPrice: true }
  },
  inventory: {
    select: { physicalQuantity: true, reservedQuantity: true }
  },
  images: {
    take: 1,
    orderBy: { position: "asc" },
    select: { url: true }
  },
  mappings: {
    take: 1,
    orderBy: { updatedAt: "desc" },
    select: {
      connectionId: true,
      externalProductId: true,
      connection: {
        select: {
          name: true,
          externalCompanyName: true,
          externalCompanyDocument: true,
          externalAccountId: true,
          isDefault: true,
          status: true
        }
      }
    }
  }
} satisfies Prisma.ProductSelect;

type ProductListRecord = Prisma.ProductGetPayload<{
  select: typeof productListSelect;
}>;

function getTestMetadata(blockedFields: unknown) {
  if (!blockedFields || typeof blockedFields !== "object" || Array.isArray(blockedFields)) {
    return {};
  }

  const fields = blockedFields as Record<string, unknown>;

  return {
    unit: typeof fields.unit === "string" ? fields.unit : null,
    origin: typeof fields.origin === "string" ? fields.origin : null,
    displayValue: typeof fields.displayValue === "string" ? fields.displayValue : null,
    salePriceDisplay: typeof fields.salePriceDisplay === "string" ? fields.salePriceDisplay : null,
    stockOverride: typeof fields.stockOverride === "number" ? fields.stockOverride : null
  };
}

function getProductAttributes(attributes: unknown) {
  return attributes && typeof attributes === "object" && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : {};
}

function getStringAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function serializeProduct(product: ProductListRecord) {
  const metadata = getTestMetadata(product.blockedFields);
  const attributes = getProductAttributes(product.attributes);
  const currentPrice = product.prices[0];
  const blingMapping = product.mappings[0];
  const blingAttributes = readBlingProductConnectionAttributes(
    attributes,
    blingMapping?.connectionId
  );
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
    origin:
      metadata.origin
      ?? getStringAttribute(blingAttributes, "origin")
      ?? product.source
      ?? product.brand,
    unit:
      metadata.unit
      ?? getStringAttribute(blingAttributes, "unit")
      ?? (typeof attributes.unit === "string" ? attributes.unit : null),
    imageUrl: product.images[0]?.url ?? null,
    status: product.status,
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
    marketplaceStores: readBlingProductMarketplaceStores(
      attributes,
      blingMapping?.connectionId
    ),
    blingStatus: readCanonicalBlingStatusFromAttributes(
      attributes,
      blingMapping?.connectionId
    ),
    displayValue: metadata.displayValue,
    salePriceDisplay: metadata.salePriceDisplay ?? currentPrice?.salePrice.toString() ?? null,
    costPrice: currentPrice?.costPrice.toString() ?? "0",
    costPriceDisplay: currentPrice?.costPrice.toString() ?? null,
    price: currentPrice?.salePrice.toString() ?? "0",
    stock: product.inventory.length
      ? product.inventory.reduce(
          (total, item) => total + item.physicalQuantity - item.reservedQuantity,
          0
        )
      : metadata.stockOverride ?? 0,
    updatedAt: product.updatedAt.toISOString()
  };
}

export async function loadProductListPage(
  authContext: TenantContext,
  searchParams: URLSearchParams
) {
  const requestedPagination = parseProductListPagination(searchParams);
  const productListFilters = parseProductListFilters(searchParams);
  const accountContext = await getUserAccountContext(authContext);
  const selectedBlingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const queryInput: ProductListQueryInput = {
    organizationId: authContext.organizationId,
    selectedBlingConnectionId,
    filters: productListFilters,
    query: searchParams.get("q")?.trim() ?? "",
    status: searchParams.get("status"),
    skuStatus: searchParams.get("skuStatus"),
    stockStatus: searchParams.get("stockStatus"),
    imageStatus: searchParams.get("imageStatus"),
    descriptionStatus: searchParams.get("descriptionStatus"),
    categoryStatus: searchParams.get("categoryStatus"),
    gtinStatus: searchParams.get("gtinStatus"),
    costStatus: searchParams.get("costStatus"),
    qualityBand: searchParams.get("qualityBand"),
    mercadoLivreCategoryStatus: searchParams.get("mercadoLivreCategoryStatus"),
    source: searchParams.get("source"),
    sort: searchParams.get("sort")
  };
  const scope = {
    organizationId: authContext.organizationId,
    selectedBlingConnectionId
  };
  const [total, metadata] = await Promise.all([
    countProductList(prisma, queryInput),
    loadProductListCatalogMetadata(prisma, scope)
  ]);
  const totalPages = Math.max(1, Math.ceil(total / requestedPagination.limit));
  const safePage = Math.min(requestedPagination.page, totalPages);
  const pagination = { page: safePage, limit: requestedPagination.limit };
  const productIds = await findProductListPageIds(prisma, queryInput, pagination);

  const products = productIds.length
    ? await prisma.product.findMany({
        where: {
          organizationId: authContext.organizationId,
          id: { in: productIds }
        },
        select: {
          ...productListSelect,
          prices: {
            ...productListSelect.prices,
            where: { organizationId: authContext.organizationId }
          },
          inventory: {
            ...productListSelect.inventory,
            where: {
              organizationId: authContext.organizationId,
              ...(selectedBlingConnectionId
                ? { connectionId: selectedBlingConnectionId }
                : {})
            }
          },
          images: {
            ...productListSelect.images,
            where: { organizationId: authContext.organizationId }
          },
          mappings: {
            ...productListSelect.mappings,
            where: {
              organizationId: authContext.organizationId,
              ...(selectedBlingConnectionId
                ? { connectionId: selectedBlingConnectionId }
                : {})
            }
          }
        },
        take: requestedPagination.limit
      })
    : [];
  const productsById = new Map(
    products.map((product) => [product.id, serializeProduct(product)])
  );
  const data = productIds.flatMap((productId) => {
    const product = productsById.get(productId);
    return product ? [product] : [];
  });

  return {
    data,
    accountContext,
    filterOptions: metadata.filterOptions,
    appliedFilters: productListFilters,
    summary: metadata.summary,
    pagination: {
      page: safePage,
      limit: requestedPagination.limit,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1
    }
  };
}

export type ProductListPageData = Awaited<ReturnType<typeof loadProductListPage>>;
