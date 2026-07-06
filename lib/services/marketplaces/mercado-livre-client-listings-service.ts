import type { Prisma } from "@prisma/client";
import { MarketplaceProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const apiBaseUrl = "https://api.mercadolibre.com";
const defaultLimit = 50;
const maxLimit = 100;
const detailsChunkSize = 20;
const listingStatuses = ["active", "paused", "closed", "under_review"] as const;

type ClientAuthContext = {
  organizationId: string;
  user: {
    id: string;
  };
};

type ListingStatusFilter = (typeof listingStatuses)[number];

type MercadoLivreItemSearchPayload = {
  results?: unknown[];
  paging?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
};

type MercadoLivreUserMePayload = {
  id?: number | string;
  nickname?: string;
};

type MercadoLivreAttribute = {
  id?: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
};

type MercadoLivrePicture = {
  id?: string;
  url?: string;
  secure_url?: string;
  size?: string;
  max_size?: string;
  quality?: string;
};

type MercadoLivreShipping = {
  mode?: string | null;
  logistic_type?: string | null;
  free_shipping?: boolean;
  tags?: string[];
};

type MercadoLivreVariation = {
  seller_custom_field?: string | null;
  attributes?: MercadoLivreAttribute[];
  attribute_combinations?: MercadoLivreAttribute[];
};

type MercadoLivreItemBody = {
  id?: string;
  title?: string;
  price?: number;
  currency_id?: string;
  status?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  category_id?: string;
  listing_type_id?: string;
  seller_custom_field?: string | null;
  available_quantity?: number;
  sold_quantity?: number;
  health?: number | null;
  attributes?: MercadoLivreAttribute[];
  pictures?: MercadoLivrePicture[];
  shipping?: MercadoLivreShipping;
  dimensions?: string | null;
  variations?: MercadoLivreVariation[];
  last_updated?: string;
  date_created?: string;
};

type MercadoLivreMultiGetEntry = {
  code?: number;
  body?: MercadoLivreItemBody;
};

type SanitizedMercadoLivreError = {
  message: string | null;
  error: string | null;
  status: number | null;
};

type MercadoLivreFetchResult<T> =
  | {
      ok: true;
      status: number;
      endpoint: string;
      data: T;
      requestId: string | null;
      correlationId: string | null;
      accessToken: string;
    }
  | {
      ok: false;
      status: number;
      endpoint: string;
      error: SanitizedMercadoLivreError;
      requestId: string | null;
      correlationId: string | null;
      accessToken: string;
    };

export type MercadoLivreClientListing = {
  externalId: string;
  itemId: string;
  title: string;
  thumbnail: string | null;
  pictures: Array<{
    id: string | null;
    url: string;
  }>;
  sellerSku: string | null;
  sku: string | null;
  gtin: string | null;
  status: string | null;
  listingTypeId: string | null;
  listingTypeLabel: string;
  price: number | null;
  currencyId: string | null;
  availableQuantity: number | null;
  health: number | null;
  permalink: string | null;
  soldQuantity: number | null;
  visits: number | null;
  categoryId: string | null;
  attributes: Array<{
    id: string | null;
    name: string;
    value: string;
  }>;
  dimensions: string | null;
  shipping: {
    mode: string | null;
    logisticType: string | null;
    freeShipping: boolean | null;
  } | null;
  dateCreated: string | null;
  updatedAt: string | null;
  lastSyncAt: string;
};

type CachedListings = {
  connectionId: string;
  listings: MercadoLivreClientListing[];
  lastSyncedAt: string;
  warnings: string[];
  totalAvailable: number | null;
  paging: MercadoLivreClientListingsPaging;
};

type MercadoLivreClientListingsPaging = {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
  total: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
};

const memoryCache = new Map<string, CachedListings>();

function cacheKey(organizationId: string, connectionId: string) {
  return `${organizationId}:${connectionId}`;
}

function truncate(value: string | null | undefined, maxLength = 180) {
  if (!value) return null;
  return value.slice(0, maxLength);
}

function sanitizeMercadoLivreErrorBody(textBody: string): SanitizedMercadoLivreError {
  try {
    const payload = JSON.parse(textBody) as { message?: unknown; error?: unknown; status?: unknown };
    return {
      message: typeof payload.message === "string" ? truncate(payload.message, 180) : null,
      error: typeof payload.error === "string" ? truncate(payload.error, 80) : null,
      status: typeof payload.status === "number" ? payload.status : null
    };
  } catch {
    return { message: null, error: null, status: null };
  }
}

function safeMercadoLivreHeaders(response: Response) {
  return {
    requestId: response.headers.get("x-request-id") ?? response.headers.get("x-amz-cf-id"),
    correlationId: response.headers.get("x-correlation-id") ?? response.headers.get("x-meli-correlation-id")
  };
}

function endpointLabel(path: string) {
  const url = new URL(`${apiBaseUrl}${path}`);
  return `${url.pathname}${url.search ? "?..." : ""}`;
}

function normalizeMercadoLivreId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sellerItemsPath(input: { sellerId: string; offset: number; limit: number; status?: ListingStatusFilter }) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  params.set("offset", String(input.offset));
  if (input.status) params.set("status", input.status);
  return `/users/${encodeURIComponent(input.sellerId)}/items/search?${params.toString()}`;
}

function pickAttribute(attributes: MercadoLivreAttribute[] | undefined, ids: string[]) {
  const normalizedIds = ids.map((id) => id.toUpperCase());
  const found = attributes?.find((attribute) => attribute.id && normalizedIds.includes(attribute.id.toUpperCase()));
  return found?.value_name?.trim() || null;
}

function allItemAttributes(item: MercadoLivreItemBody) {
  const variation = item.variations?.[0];
  return [
    ...(item.attributes ?? []),
    ...(variation?.attributes ?? []),
    ...(variation?.attribute_combinations ?? [])
  ];
}

function normalizeItemAttributes(item: MercadoLivreItemBody) {
  const seen = new Set<string>();
  const normalized: MercadoLivreClientListing["attributes"] = [];

  for (const attribute of allItemAttributes(item)) {
    const name = attribute.name?.trim();
    const value = attribute.value_name?.trim();
    if (!name || !value) continue;
    const key = `${attribute.id ?? name}:${value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: attribute.id?.trim() || null,
      name,
      value
    });
  }

  return normalized.slice(0, 24);
}

function normalizePictures(item: MercadoLivreItemBody) {
  const pictures = (item.pictures ?? [])
    .map((picture) => ({
      id: picture.id?.trim() || null,
      url: picture.secure_url?.trim() || picture.url?.trim() || ""
    }))
    .filter((picture) => picture.url);

  if (!pictures.length) {
    const thumbnail = typeof item.secure_thumbnail === "string" ? item.secure_thumbnail : typeof item.thumbnail === "string" ? item.thumbnail : null;
    return thumbnail ? [{ id: null, url: thumbnail }] : [];
  }

  return pictures;
}

function listingTypeLabel(value: string | null) {
  if (value === "gold_pro") return "Premium";
  if (value === "gold_special") return "Classico";
  return value || "-";
}

function normalizeListing(item: MercadoLivreItemBody, syncedAt: Date): MercadoLivreClientListing | null {
  const externalId = normalizeMercadoLivreId(item.id);
  const title = typeof item.title === "string" ? item.title.trim() : null;
  if (!externalId || !title) return null;

  const attributes = allItemAttributes(item);
  const sellerSku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    pickAttribute(attributes, ["SELLER_SKU", "SKU"]);
  const rawGtin = pickAttribute(attributes, ["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE"]);
  const normalizedGtin = rawGtin ? normalizeGtin(rawGtin) : null;
  const updatedAt = typeof item.last_updated === "string" ? item.last_updated : typeof item.date_created === "string" ? item.date_created : null;
  const listingTypeId = typeof item.listing_type_id === "string" ? item.listing_type_id : null;

  return {
    externalId,
    itemId: externalId,
    title,
    thumbnail: typeof item.secure_thumbnail === "string" ? item.secure_thumbnail : typeof item.thumbnail === "string" ? item.thumbnail : null,
    pictures: normalizePictures(item),
    sellerSku: sellerSku || null,
    sku: sellerSku || null,
    gtin: normalizedGtin || null,
    status: typeof item.status === "string" ? item.status : null,
    listingTypeId,
    listingTypeLabel: listingTypeLabel(listingTypeId),
    price: typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null,
    currencyId: typeof item.currency_id === "string" ? item.currency_id : null,
    availableQuantity: typeof item.available_quantity === "number" && Number.isFinite(item.available_quantity) ? item.available_quantity : null,
    health: typeof item.health === "number" && Number.isFinite(item.health) ? item.health : null,
    permalink: typeof item.permalink === "string" ? item.permalink : null,
    soldQuantity: typeof item.sold_quantity === "number" && Number.isFinite(item.sold_quantity) ? item.sold_quantity : null,
    visits: null,
    categoryId: typeof item.category_id === "string" ? item.category_id : null,
    attributes: normalizeItemAttributes(item),
    dimensions: typeof item.dimensions === "string" && item.dimensions.trim() ? item.dimensions.trim() : null,
    shipping: item.shipping
      ? {
          mode: typeof item.shipping.mode === "string" ? item.shipping.mode : null,
          logisticType: typeof item.shipping.logistic_type === "string" ? item.shipping.logistic_type : null,
          freeShipping: typeof item.shipping.free_shipping === "boolean" ? item.shipping.free_shipping : null
        }
      : null,
    dateCreated: typeof item.date_created === "string" ? item.date_created : null,
    updatedAt,
    lastSyncAt: syncedAt.toISOString()
  };
}

async function audit(input: { organizationId: string; userId: string | null; action: string; metadata: Record<string, unknown> }) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      entity: "MarketplaceConnection",
      entityType: "MarketplaceConnection",
      metadata: sanitizeLogPayload(input.metadata) as Prisma.InputJsonObject
    }
  });
}

async function fetchMercadoLivreJson<T>(input: {
  organizationId: string;
  connectionId: string;
  accessToken: string;
  path: string;
  retryOnUnauthorized?: boolean;
}): Promise<MercadoLivreFetchResult<T>> {
  let accessToken = input.accessToken;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${apiBaseUrl}${input.path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    const safeHeaders = safeMercadoLivreHeaders(response);

    if (response.status === 401 && attempt === 0 && input.retryOnUnauthorized !== false) {
      const refreshed = await mercadoLivreClientOAuthService.refreshConnectionToken({
        organizationId: input.organizationId,
        connectionId: input.connectionId
      });
      accessToken = refreshed.accessToken;
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        endpoint: endpointLabel(input.path),
        error: sanitizeMercadoLivreErrorBody(await response.text()),
        requestId: safeHeaders.requestId,
        correlationId: safeHeaders.correlationId,
        accessToken
      };
    }

    return {
      ok: true,
      status: response.status,
      endpoint: endpointLabel(input.path),
      data: (await response.json()) as T,
      requestId: safeHeaders.requestId,
      correlationId: safeHeaders.correlationId,
      accessToken
    };
  }

  throw new Error("Falha ao renovar token Mercado Livre.");
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildKpis(listings: MercadoLivreClientListing[]) {
  return {
    active: listings.filter((listing) => listing.status === "active").length,
    paused: listings.filter((listing) => listing.status === "paused").length,
    errors: listings.filter((listing) => listing.status === "under_review" || listing.status === "inactive").length,
    withoutStock: listings.filter((listing) => (listing.availableQuantity ?? 0) <= 0).length,
    sales: listings.reduce((total, listing) => total + (listing.soldQuantity ?? 0), 0),
    visits: 0
  };
}

function buildPaging(input: { limit: number; offset: number; totalAvailable: number | null }) {
  const pageSize = input.limit;
  const page = Math.floor(input.offset / pageSize) + 1;
  return {
    limit: pageSize,
    offset: input.offset,
    page,
    pageSize,
    total: input.totalAvailable,
    hasPrevious: input.offset > 0,
    hasNext: typeof input.totalAvailable === "number" ? input.offset + pageSize < input.totalAvailable : false
  };
}

function safeAccount(connection: Awaited<ReturnType<typeof prisma.marketplaceConnection.findUnique>>) {
  return {
    connected: Boolean(connection && connection.status === "ACTIVE"),
    marketplace: MarketplaceProvider.MERCADOLIVRE,
    accountName: connection?.accountAlias ?? null,
    status: connection?.status ?? "NOT_CONFIGURED",
    sellerId: connection?.sellerId ?? connection?.externalAccountId ?? null,
    externalAccountId: connection?.externalAccountId ?? null,
    siteId: connection?.siteId ?? "MLB",
    connectedAt: connection?.connectedAt ?? null,
    expiresAt: connection?.expiresAt ?? null,
    lastSyncAt: connection?.lastSyncAt ?? null
  };
}

export class MercadoLivreClientListingsService {
  async getListings(authContext: ClientAuthContext) {
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        organizationId_provider: {
          organizationId: authContext.organizationId,
          provider: MarketplaceProvider.MERCADOLIVRE
        }
      }
    });
    const cached = connection ? memoryCache.get(cacheKey(authContext.organizationId, connection.id)) : null;

    return {
      connected: Boolean(connection && connection.status === "ACTIVE"),
      account: safeAccount(connection),
      listings: cached?.listings ?? [],
      kpis: buildKpis(cached?.listings ?? []),
      lastSyncedAt: cached?.lastSyncedAt ?? connection?.lastSyncAt?.toISOString() ?? null,
      warnings: cached?.warnings ?? [],
      totalAvailable: cached?.totalAvailable ?? null,
      paging: cached?.paging ?? buildPaging({ limit: defaultLimit, offset: 0, totalAvailable: cached?.totalAvailable ?? null }),
      cache: cached ? "memory" : "empty",
      readOnly: true,
      externalWrite: false
    };
  }

  async syncListings(input: { authContext: ClientAuthContext; limit?: number; offset?: number; status?: ListingStatusFilter }) {
    const requestedLimit = Math.max(1, Math.min(input.limit ?? defaultLimit, maxLimit));
    const requestedOffset = Math.max(0, input.offset ?? 0);
    const requestedStatus = input.status && listingStatuses.includes(input.status) ? input.status : undefined;
    const { connection, accessToken: initialAccessToken } = await mercadoLivreClientOAuthService.getAccessTokenForActiveConnection(input.authContext.organizationId);
    const sellerId = connection.sellerId ?? connection.externalAccountId;
    if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "ML_MANAGER_LISTINGS_SYNC_START",
      metadata: {
        provider: MarketplaceProvider.MERCADOLIVRE,
        connectionId: connection.id,
        sellerId,
        limit: requestedLimit,
        offset: requestedOffset,
        status: requestedStatus ?? "all",
        externalWrite: false
      }
    });

    let accessToken = initialAccessToken;
    const warnings: string[] = [];
    const endpointDiagnostics: Array<Record<string, unknown>> = [];

    const accountProbe = await fetchMercadoLivreJson<MercadoLivreUserMePayload>({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      path: "/users/me"
    });
    accessToken = accountProbe.accessToken;
    if (!accountProbe.ok) {
      warnings.push("Nao foi possivel validar /users/me nesta sincronizacao read-only.");
    } else {
      const returnedSellerId = normalizeMercadoLivreId(accountProbe.data.id);
      if (returnedSellerId && returnedSellerId !== sellerId) {
        warnings.push("O seller retornado por /users/me nao corresponde ao seller salvo na conexao.");
      }
    }

    let totalAvailable: number | null = null;

    const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      path: sellerItemsPath({ sellerId, offset: requestedOffset, limit: requestedLimit, status: requestedStatus })
    });
    accessToken = response.accessToken;
    endpointDiagnostics.push({
      endpoint: response.endpoint,
      status: response.status,
      listingStatus: requestedStatus ?? "all",
      requestId: response.requestId,
      correlationId: response.correlationId,
      returnedIds: response.ok ? response.data.results?.length ?? 0 : 0,
      total: response.ok ? response.data.paging?.total ?? null : null,
      offset: requestedOffset,
      limit: requestedLimit,
      errorCode: response.ok ? null : response.error.error,
      errorMessage: response.ok ? null : response.error.message
    });

    if (!response.ok) {
      warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar anuncios.`);
    } else if (typeof response.data.paging?.total === "number") {
      totalAvailable = response.data.paging.total;
    }

    const itemIds = response.ok
      ? (response.data.results ?? [])
          .map((id) => normalizeMercadoLivreId(id))
          .filter((id): id is string => Boolean(id))
          .slice(0, requestedLimit)
      : [];
    const syncedAt = new Date();
    const listings: MercadoLivreClientListing[] = [];

    for (const ids of chunk(itemIds, detailsChunkSize)) {
      const response = await fetchMercadoLivreJson<MercadoLivreMultiGetEntry[]>({
        organizationId: input.authContext.organizationId,
        connectionId: connection.id,
        accessToken,
        path: `/items?ids=${ids.map(encodeURIComponent).join(",")}`
      });
      accessToken = response.accessToken;
      endpointDiagnostics.push({
        endpoint: response.endpoint,
        status: response.status,
        requestId: response.requestId,
        correlationId: response.correlationId,
        returnedItems: response.ok ? response.data.length : 0,
        errorCode: response.ok ? null : response.error.error,
        errorMessage: response.ok ? null : response.error.message
      });

      if (!response.ok) {
        warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar detalhes dos anuncios.`);
        continue;
      }

      for (const entry of response.data) {
        if (entry.code && entry.code !== 200) {
          warnings.push(`Um anuncio Mercado Livre retornou codigo ${entry.code} no detalhe.`);
          continue;
        }
        const normalized = entry.body ? normalizeListing(entry.body, syncedAt) : null;
        if (normalized) listings.push(normalized);
      }
    }

    const updatedConnection = await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: syncedAt,
        lastError: warnings[0] ?? null
      }
    });

    memoryCache.set(cacheKey(input.authContext.organizationId, connection.id), {
      connectionId: connection.id,
      listings,
      lastSyncedAt: syncedAt.toISOString(),
      warnings,
      totalAvailable,
      paging: buildPaging({ limit: requestedLimit, offset: requestedOffset, totalAvailable })
    });

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: warnings.length ? "ML_MANAGER_LISTINGS_SYNC_PARTIAL" : "ML_MANAGER_LISTINGS_SYNC_SUCCESS",
      metadata: {
        provider: MarketplaceProvider.MERCADOLIVRE,
        connectionId: connection.id,
        sellerId,
        foundItemIds: itemIds.length,
        detailsFetched: listings.length,
        totalAvailable,
        offset: requestedOffset,
        limit: requestedLimit,
        warnings: warnings.length,
        endpoints: endpointDiagnostics.length,
        externalWrite: false
      }
    });

    return {
      connected: true,
      account: safeAccount(updatedConnection),
      listings,
      kpis: buildKpis(listings),
      foundItemIds: itemIds.length,
      detailsFetched: listings.length,
      totalAvailable,
      paging: buildPaging({ limit: requestedLimit, offset: requestedOffset, totalAvailable }),
      lastSyncedAt: syncedAt.toISOString(),
      warnings,
      endpointDiagnostics,
      readOnly: true,
      externalWrite: false
    };
  }
}

export const mercadoLivreClientListingsService = new MercadoLivreClientListingsService();
