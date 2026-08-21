import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import {
  readBlingProductConnectionAttributes,
  readBlingProductMarketplaceStores,
  readCanonicalBlingStatusFromAttributes
} from "@/lib/services/bling-product-import-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { parseProductListFilters } from "@/lib/product-list-filters";
import {
  countProductList,
  findProductListPageIds,
  loadProductListCatalogMetadata,
  parseProductListPagination,
  type ProductListQueryInput
} from "@/lib/product-list-query";
import { productCreateSchema } from "@/lib/validation";

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

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
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
      ? product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0)
      : metadata.stockOverride ?? 0,
    updatedAt: product.updatedAt
  };
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const requestedPagination = parseProductListPagination(url.searchParams);
  const productListFilters = parseProductListFilters(url.searchParams);
  const accountContext = await getUserAccountContext(auth.context);
  const selectedBlingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const queryInput: ProductListQueryInput = {
    organizationId: auth.context.organizationId,
    selectedBlingConnectionId,
    filters: productListFilters,
    query: url.searchParams.get("q")?.trim() ?? "",
    status: url.searchParams.get("status"),
    skuStatus: url.searchParams.get("skuStatus"),
    stockStatus: url.searchParams.get("stockStatus"),
    imageStatus: url.searchParams.get("imageStatus"),
    descriptionStatus: url.searchParams.get("descriptionStatus"),
    categoryStatus: url.searchParams.get("categoryStatus"),
    gtinStatus: url.searchParams.get("gtinStatus"),
    costStatus: url.searchParams.get("costStatus"),
    qualityBand: url.searchParams.get("qualityBand"),
    mercadoLivreCategoryStatus: url.searchParams.get("mercadoLivreCategoryStatus"),
    source: url.searchParams.get("source"),
    sort: url.searchParams.get("sort")
  };
  const scope = {
    organizationId: auth.context.organizationId,
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

  const products = productIds.length ? await prisma.product.findMany({
    where: {
      organizationId: auth.context.organizationId,
      id: { in: productIds }
    },
    select: {
      ...productListSelect,
      prices: {
        ...productListSelect.prices,
        where: { organizationId: auth.context.organizationId }
      },
      inventory: {
        ...productListSelect.inventory,
        where: {
          organizationId: auth.context.organizationId,
          ...(selectedBlingConnectionId
            ? { connectionId: selectedBlingConnectionId }
            : {})
        }
      },
      images: {
        ...productListSelect.images,
        where: { organizationId: auth.context.organizationId }
      },
      mappings: {
        ...productListSelect.mappings,
        where: {
          organizationId: auth.context.organizationId,
          ...(selectedBlingConnectionId
            ? { connectionId: selectedBlingConnectionId }
            : {})
        }
      }
    },
    take: requestedPagination.limit
  }) : [];
  const productsById = new Map(products.map((product) => [product.id, serializeProduct(product)]));
  const data = productIds.flatMap((productId) => {
    const product = productsById.get(productId);
    return product ? [product] : [];
  });

  return NextResponse.json({
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
