import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import { readCanonicalBlingStatusFromAttributes } from "@/lib/services/bling-product-import-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import {
  buildProductListFilterOptions,
  matchesProductListFilters,
  parseProductListFilters
} from "@/lib/product-list-filters";
import { productCreateSchema } from "@/lib/validation";

type ProductListRecord = Prisma.ProductGetPayload<{
  include: {
    prices: true;
    inventory: true;
    images: true;
    enrichmentDrafts: true;
    mappings: {
      include: {
        connection: true;
      };
    };
    marketplaceCategoryMappings: {
      include: {
        productAttributeValues: {
          select: {
            attributeId: true;
            value: true;
            status: true;
          };
        };
      };
    };
  };
}>;

type SerializedProduct = ReturnType<typeof serializeProduct>;

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

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function skuStatusWhere(skuStatus: string | null): Prisma.ProductWhereInput {
  if (skuStatus === "with") {
    return {
      AND: [
        { sku: { not: null } },
        { sku: { not: "" } },
        { NOT: { sku: { startsWith: "BLING-" } } }
      ]
    };
  }

  if (skuStatus === "without") {
    return {
      OR: [
        { sku: null },
        { sku: "" },
        { sku: { startsWith: "BLING-" } }
      ]
    };
  }

  return {};
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function hasRealSku(value: string | null | undefined) {
  const sku = value?.trim();
  return Boolean(sku && !sku.toUpperCase().startsWith("BLING-"));
}

function normalizeMarketplaceKey(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text.toUpperCase() : null;
}

function isLinkedMercadoLivreStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase();
  return !normalized || !["closed", "deleted", "inactive"].includes(normalized);
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(numeric) ? numeric : 0;
}

function getQualityScore(product: SerializedProduct) {
  let score = 0;
  if (product.name.trim()) score += 10;
  if (hasRealSku(product.sku)) score += 15;
  if (hasText(product.ean)) score += 15;
  if (toNumber(product.price) > 0) score += 10;
  if (product.stock > 0) score += 10;
  if (toNumber(product.costPrice) > 0) score += 10;
  if (hasText(product.imageUrl)) score += 10;
  if (hasText(product.description)) score += 5;
  if (hasText(product.brand)) score += 10;
  if (hasText(product.category)) score += 5;
  return Math.min(score, 100);
}

function isReadyProduct(product: SerializedProduct) {
  return (
    hasText(product.name) &&
    hasRealSku(product.sku) &&
    hasText(product.ean) &&
    toNumber(product.price) > 0 &&
    product.stock > 0 &&
    toNumber(product.costPrice) > 0 &&
    hasText(product.imageUrl) &&
    hasText(product.description) &&
    hasText(product.brand) &&
    hasText(product.category)
  );
}

function getQualityBand(score: number, product: SerializedProduct) {
  if (score <= 30) return "critical";
  if (score <= 60) return "needsReview";
  if (score <= 80) return "good";
  return isReadyProduct(product) ? "ready" : "good";
}

function matchesStateFilter(filter: string | null, present: boolean) {
  if (!filter) return true;
  if (filter === "with") return present;
  if (filter === "without") return !present;
  return true;
}

function hasRequiredAttributesSynced(value: unknown) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function requiredAttributeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attribute) => {
      const tags = typeof attribute === "object" && attribute !== null && "tags" in attribute
        ? (attribute as { tags?: Record<string, unknown> }).tags
        : null;
      return tags?.required === true || tags?.catalog_required === true;
    })
    .map((attribute) => {
      const id = typeof attribute === "object" && attribute !== null && "id" in attribute
        ? (attribute as { id?: unknown }).id
        : null;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    })
    .filter((id): id is string => Boolean(id));
}

function hasFilledRequiredAttributeValues(mapping: SerializedProduct["marketplaceCategories"][number] | undefined) {
  const requiredIds = requiredAttributeIds(mapping?.requiredAttributes);
  if (!requiredIds.length) return false;
  const values = mapping?.attributeValues ?? [];
  const confirmed = new Set(values.filter((value) => value.status === "CONFIRMED" && hasText(value.value)).map((value) => value.attributeId));
  return requiredIds.every((id) => confirmed.has(id));
}

function hasDimensions(product: SerializedProduct) {
  return Boolean(product.weight && product.height && product.width && product.depth);
}

function matchesMercadoLivreFilter(filter: string | null, product: SerializedProduct) {
  if (!filter) return true;
  const mapping = product.marketplaceCategories.find((item) => item.provider === "MERCADO_LIVRE");
  const hasMapping = Boolean(mapping);
  const hasOfficialId = hasText(mapping?.marketplaceCategoryId);
  const hasAttributesSynced = hasRequiredAttributesSynced(mapping?.requiredAttributes);
  const hasAttributes = hasFilledRequiredAttributeValues(mapping);
  const readyForReview =
    mapping?.status === "CONFIRMED" &&
    hasOfficialId &&
    hasAttributes &&
    hasText(product.name) &&
    toNumber(product.price) > 0 &&
    product.stock > 0 &&
    hasText(product.imageUrl) &&
    hasText(product.ean) &&
    hasText(product.brand) &&
    hasText(product.description) &&
    hasDimensions(product);

  if (filter === "with") return hasMapping;
  if (filter === "without") return !hasMapping;
  if (filter === "suggested") return mapping?.status === "SUGGESTED";
  if (filter === "confirmed") return mapping?.status === "CONFIRMED";
  if (filter === "rejected") return mapping?.status === "REJECTED";
  if (filter === "withOfficialId") return hasOfficialId;
  if (filter === "withoutOfficialId") return !hasOfficialId;
  if (filter === "attributesPending") return hasOfficialId && (!hasAttributesSynced || !hasAttributes);
  if (filter === "readyForReview") return readyForReview;
  return true;
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", "pt-BR", { sensitivity: "base" });
}

function sortProducts(products: SerializedProduct[], sort: string | null) {
  return [...products].sort((left, right) => {
    const leftQuality = getQualityScore(left);
    const rightQuality = getQualityScore(right);
    const leftStock = left.stock;
    const rightStock = right.stock;
    const leftSku = hasRealSku(left.sku) ? 1 : 0;
    const rightSku = hasRealSku(right.sku) ? 1 : 0;
    const leftImage = hasText(left.imageUrl) ? 1 : 0;
    const rightImage = hasText(right.imageUrl) ? 1 : 0;
    const leftPrice = toNumber(left.price);
    const rightPrice = toNumber(right.price);
    const leftStockValue = leftPrice * leftStock;
    const rightStockValue = rightPrice * rightStock;

    if (sort === "quality_asc") return leftQuality - rightQuality || compareText(left.name, right.name);
    if (sort === "stock_desc") return rightStock - leftStock || compareText(left.name, right.name);
    if (sort === "without_sku") return leftSku - rightSku || rightQuality - leftQuality || compareText(left.name, right.name);
    if (sort === "recent") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (sort === "name_asc") return compareText(left.name, right.name);
    if (sort === "stock_value_desc") return rightStockValue - leftStockValue || compareText(left.name, right.name);
    if (sort === "price_desc") return rightPrice - leftPrice || compareText(left.name, right.name);
    if (sort === "price_asc") return leftPrice - rightPrice || compareText(left.name, right.name);

    return (
      rightQuality - leftQuality ||
      Number(rightStock > 0) - Number(leftStock > 0) ||
      rightSku - leftSku ||
      rightImage - leftImage ||
      compareText(left.name, right.name)
    );
  });
}

function serializeProduct(product: ProductListRecord) {
  const metadata = getTestMetadata(product.blockedFields);
  const attributes = getProductAttributes(product.attributes);
  const currentPrice = product.prices[0];
  const blingMapping = product.mappings[0];
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
    description: product.description,
    category: product.category,
    brand: product.brand,
    ncm: product.ncm,
    origin: product.source ?? metadata.origin ?? product.brand,
    unit: metadata.unit ?? (typeof attributes.unit === "string" ? attributes.unit : null),
    imageUrl: product.images[0]?.url ?? null,
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
    marketplaceStores: {
      mercadoLivre: false
    },
    blingStatus: readCanonicalBlingStatusFromAttributes(attributes),
    confidenceScore: product.confidenceScore,
    weight: product.weight?.toString() ?? null,
    height: product.height?.toString() ?? null,
    width: product.width?.toString() ?? null,
    depth: product.depth?.toString() ?? null,
    attributes: product.attributes,
    displayValue: metadata.displayValue,
    salePriceDisplay: metadata.salePriceDisplay ?? currentPrice?.salePrice.toString() ?? null,
    costPrice: currentPrice?.costPrice.toString() ?? "0",
    costPriceDisplay: currentPrice?.costPrice.toString() ?? null,
    price: currentPrice?.salePrice.toString() ?? "0",
    stock: product.inventory.length
      ? product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0)
      : metadata.stockOverride ?? 0,
    updatedAt: product.updatedAt
  };
}

async function attachMarketplaceStores(organizationId: string, products: SerializedProduct[]) {
  if (!products.length) return products;

  const listingRows = await prisma.mercadoLivreListingCache.findMany({
    where: { organizationId },
    select: {
      sku: true,
      status: true
    }
  });

  if (!listingRows.length) return products;

  const mercadoLivreSkus = new Set<string>();

  for (const listing of listingRows) {
    if (!isLinkedMercadoLivreStatus(listing.status)) continue;

    const sku = normalizeMarketplaceKey(listing.sku);
    if (sku) mercadoLivreSkus.add(sku);
  }

  return products.map((product) => {
    const sku = normalizeMarketplaceKey(product.sku);
    const hasMercadoLivreListing = Boolean(sku && mercadoLivreSkus.has(sku));

    return {
      ...product,
      marketplaceStores: {
        ...product.marketplaceStores,
        mercadoLivre: hasMercadoLivreListing
      }
    };
  });
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const rawLimit = url.searchParams.get("limit");
  const loadAll = rawLimit === null || rawLimit === "all";
  const limit = loadAll ? null : Math.min(Math.max(10, Number.parseInt(rawLimit ?? "100", 10) || 100), 1000);
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const status = url.searchParams.get("status");
  const skuStatus = url.searchParams.get("skuStatus");
  const stockStatus = url.searchParams.get("stockStatus");
  const imageStatus = url.searchParams.get("imageStatus");
  const descriptionStatus = url.searchParams.get("descriptionStatus");
  const categoryStatus = url.searchParams.get("categoryStatus");
  const gtinStatus = url.searchParams.get("gtinStatus");
  const costStatus = url.searchParams.get("costStatus");
  const qualityBand = url.searchParams.get("qualityBand");
  const mercadoLivreCategoryStatus = url.searchParams.get("mercadoLivreCategoryStatus");
  const source = url.searchParams.get("source");
  const sort = url.searchParams.get("sort");
  const productListFilters = parseProductListFilters(url.searchParams);
  const accountContext = await getUserAccountContext(auth.context);
  const selectedBlingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const products = await prisma.product.findMany({
    where: {
      organizationId: auth.context.organizationId,
      ...skuStatusWhere(skuStatus),
      ...(selectedBlingConnectionId
        ? {
            mappings: {
              some: {
                organizationId: auth.context.organizationId,
                connectionId: selectedBlingConnectionId
              }
            }
          }
        : {})
    },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } },
      mappings: {
        where: selectedBlingConnectionId ? { connectionId: selectedBlingConnectionId } : undefined,
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          connection: true
        }
      },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1,
        orderBy: { updatedAt: "desc" },
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
    },
    orderBy: { createdAt: "desc" }
  });

  const serialized = products.map(serializeProduct);
  const filterOptions = buildProductListFilterOptions(serialized);
  const summary = {
    totalProducts: serialized.length,
    importedFromBlingCount: serialized.filter((product) => product.blingAccount).length,
    readyForTestCount: serialized.filter((product) => product.status === "READY_FOR_TEST").length,
    unknownBlingStatusCount: serialized.filter((product) => product.blingStatus === "UNKNOWN").length
  };
  const filtered = serialized.filter((product) => {
    const score = getQualityScore(product);
    return (
      matchesProductListFilters(product, productListFilters, query) &&
      (!stockStatus || matchesStateFilter(stockStatus, product.stock > 0)) &&
      (!imageStatus || matchesStateFilter(imageStatus, hasText(product.imageUrl))) &&
      matchesStateFilter(descriptionStatus, hasText(product.description)) &&
      matchesStateFilter(categoryStatus, hasText(product.category)) &&
      (!gtinStatus || matchesStateFilter(gtinStatus, hasText(product.ean))) &&
      matchesStateFilter(costStatus, toNumber(product.costPrice) > 0) &&
      (!qualityBand || getQualityBand(score, product) === qualityBand) &&
      matchesMercadoLivreFilter(mercadoLivreCategoryStatus, product) &&
      (!status || product.enrichmentStatus === status) &&
      (!source || product.source === source)
    );
  });
  const sorted = sortProducts(filtered, sort);
  const total = sorted.length;
  const totalPages = limit ? Math.max(1, Math.ceil(total / limit)) : 1;
  const safePage = limit ? Math.min(page, totalPages) : 1;
  const start = limit ? (safePage - 1) * limit : 0;
  const pageProducts = limit ? sorted.slice(start, start + limit) : sorted;
  const data = await attachMarketplaceStores(auth.context.organizationId, pageProducts);

  return NextResponse.json({
    data,
    accountContext,
    filterOptions,
    appliedFilters: productListFilters,
    summary,
    pagination: {
      page: safePage,
      limit: limit ?? "all",
      total,
      totalPages,
      hasNextPage: Boolean(limit && safePage < totalPages),
      hasPreviousPage: Boolean(limit && safePage > 1)
    }
  });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = productCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const ean = normalizeGtin(parsed.data.ean);
  if (!isValidGtin(ean)) {
    return NextResponse.json(
      { error: "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos." },
      { status: 400 }
    );
  }

  const product = await prisma.product.create({
    data: {
      organizationId: auth.context.organizationId,
      name: parsed.data.name,
      sku: normalizeOptionalText(parsed.data.sku),
      ean,
      description: parsed.data.description,
      brand: parsed.data.brand,
      category: parsed.data.category,
      ncm: parsed.data.ncm,
      cest: parsed.data.cest,
      enrichmentStatus: "IMPORTED",
      syncStatus: "NOT_SYNCED",
      source: "Cadastro manual",
      prices:
        parsed.data.salePrice || parsed.data.costPrice
          ? { create: { organizationId: auth.context.organizationId, salePrice: parsed.data.salePrice ?? 0, costPrice: parsed.data.costPrice ?? 0 } }
          : undefined
    }
  });

  return NextResponse.json({ data: { id: product.id, name: product.name, sku: product.sku }, status: "created" }, { status: 201 });
}
