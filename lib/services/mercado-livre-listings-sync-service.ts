import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import {
  findLocalProductForMercadoLivreSearch,
  mercadoLivreOAuthService,
  normalizeMercadoLivreSearchMode,
  resolveMercadoLivreSearch,
  toSafeMercadoLivreAccount,
  toSafeMercadoLivreSearchProduct,
  type MercadoLivreSearchAuthContext
} from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

const apiBaseUrl = "https://api.mercadolibre.com";
const defaultPageLimit = 50;
const defaultMaxPages = 20;
const defaultMaxItems = 500;
const itemDetailsChunkSize = 20;
const listingStatusFilters = [null, "active", "paused", "closed", "under_review"] as const;

type ListingSyncAuthContext = MercadoLivreSearchAuthContext;
type MercadoLivreListingStatusFilter = (typeof listingStatusFilters)[number];

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
  seller_custom_field?: string | null;
  attributes?: MercadoLivreAttribute[];
  variations?: MercadoLivreVariation[];
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
    }
  | {
      ok: false;
      status: number;
      endpoint: string;
      error: SanitizedMercadoLivreError;
      requestId: string | null;
      correlationId: string | null;
    };

type NormalizedListing = {
  externalItemId: string;
  title: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  partNumber: string | null;
  categoryId: string | null;
  price: number | null;
  currencyId: string | null;
  status: string | null;
  permalink: string | null;
  thumbnail: string | null;
  rawAttributesJson: Prisma.InputJsonValue;
};

function truncate(value: string | null | undefined, maxLength = 180) {
  if (!value) return null;
  return value.slice(0, maxLength);
}

function sanitizeMercadoLivreErrorBody(textBody: string): SanitizedMercadoLivreError {
  const fallback = { message: null, error: null, status: null };
  try {
    const payload = JSON.parse(textBody) as { message?: unknown; error?: unknown; status?: unknown };
    return {
      message: typeof payload.message === "string" ? truncate(payload.message, 180) : null,
      error: typeof payload.error === "string" ? truncate(payload.error, 80) : null,
      status: typeof payload.status === "number" ? payload.status : null
    };
  } catch {
    return fallback;
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

function itemStatusLabel(status: MercadoLivreListingStatusFilter) {
  return status ?? "all";
}

function sellerItemsPath(input: { externalUserId: string; offset?: number; status?: MercadoLivreListingStatusFilter }) {
  const params = new URLSearchParams();
  if (typeof input.offset === "number") {
    params.set("limit", String(defaultPageLimit));
    params.set("offset", String(input.offset));
  }
  if (input.status) params.set("status", input.status);
  const query = params.toString();
  return `/users/${encodeURIComponent(input.externalUserId)}/items/search${query ? `?${query}` : ""}`;
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

function normalizeListing(item: MercadoLivreItemBody): NormalizedListing | null {
  const externalItemId = normalizeMercadoLivreId(item.id);
  const title = typeof item.title === "string" ? item.title.trim() : null;
  if (!externalItemId || !title) return null;

  const attributes = allItemAttributes(item);
  const sku =
    item.seller_custom_field?.trim() ||
    item.variations?.find((variation) => variation.seller_custom_field?.trim())?.seller_custom_field?.trim() ||
    pickAttribute(attributes, ["SELLER_SKU", "SKU"]);
  const rawGtin = pickAttribute(attributes, ["GTIN", "EAN", "UPC", "UNIVERSAL_PRODUCT_CODE"]);
  const normalizedGtin = rawGtin ? normalizeGtin(rawGtin) : null;

  return {
    externalItemId,
    title,
    sku: sku || null,
    gtin: normalizedGtin || null,
    brand: pickAttribute(attributes, ["BRAND", "MARCA"]),
    partNumber: pickAttribute(attributes, ["PART_NUMBER", "MANUFACTURER_PART_NUMBER", "MPN", "OEM"]),
    categoryId: typeof item.category_id === "string" ? item.category_id : null,
    price: typeof item.price === "number" && Number.isFinite(item.price) ? item.price : null,
    currencyId: typeof item.currency_id === "string" ? item.currency_id : null,
    status: typeof item.status === "string" ? item.status : null,
    permalink: typeof item.permalink === "string" ? item.permalink : null,
    thumbnail: typeof item.secure_thumbnail === "string" ? item.secure_thumbnail : typeof item.thumbnail === "string" ? item.thumbnail : null,
    rawAttributesJson: {
      attributes: attributes.map((attribute) => ({
        id: attribute.id ?? null,
        name: attribute.name ?? null,
        valueId: attribute.value_id ?? null,
        valueName: attribute.value_name ?? null
      }))
    }
  };
}

function toSafeCacheItem(item: {
  externalItemId: string;
  title: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  partNumber: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: Prisma.Decimal | null;
  currencyId: string | null;
  status: string | null;
  permalink: string | null;
  thumbnail: string | null;
  lastSyncedAt: Date;
}) {
  return {
    externalItemId: item.externalItemId,
    title: item.title,
    sku: item.sku,
    gtin: item.gtin,
    brand: item.brand,
    partNumber: item.partNumber,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    price: item.price ? Number(item.price.toString()) : null,
    currencyId: item.currencyId,
    status: item.status,
    permalink: item.permalink,
    imageUrl: item.thumbnail,
    thumbnail: item.thumbnail,
    lastSyncedAt: item.lastSyncedAt,
    source: "MERCADO_LIVRE_CACHE_READ_ONLY"
  };
}

async function audit(input: { organizationId: string; userId: string | null; action: string; metadata: Record<string, unknown> }) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      entity: "MercadoLivreListingCache",
      entityType: "MercadoLivreListingCache",
      metadata: sanitizeLogPayload(input.metadata) as Prisma.InputJsonObject
    }
  });
}

async function fetchMercadoLivreJson<T>(input: { organizationId: string; connectionId: string; accessToken: string; path: string; retryOnUnauthorized?: boolean }): Promise<MercadoLivreFetchResult<T>> {
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
      accessToken = await mercadoLivreOAuthService.refreshConnectionToken(input.connectionId, input.organizationId);
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        endpoint: endpointLabel(input.path),
        error: sanitizeMercadoLivreErrorBody(await response.text()),
        requestId: safeHeaders.requestId,
        correlationId: safeHeaders.correlationId
      };
    }

    return {
      ok: true,
      status: response.status,
      endpoint: endpointLabel(input.path),
      data: (await response.json()) as T,
      requestId: safeHeaders.requestId,
      correlationId: safeHeaders.correlationId
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

export class MercadoLivreListingsSyncService {
  async getActiveMercadoLivreConnection(organizationId: string) {
    const token = await mercadoLivreOAuthService.getAccessTokenForConnection(organizationId);
    if (!token) throw new Error("Conecte uma conta Mercado Livre antes de sincronizar anuncios.");
    if (!token.connection.externalUserId) throw new Error("Conexao Mercado Livre sem seller identificado. Reconecte a conta.");
    return token;
  }

  async fetchConnectedUserReadOnly(input: { organizationId: string; connectionId: string; accessToken: string; expectedExternalUserId: string }) {
    const response = await fetchMercadoLivreJson<MercadoLivreUserMePayload>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      accessToken: input.accessToken,
      path: "/users/me"
    });

    if (!response.ok) {
      return {
        ok: false as const,
        endpoint: response.endpoint,
        status: response.status,
        errorCode: response.error.error,
        errorMessage: response.error.message,
        requestId: response.requestId,
        correlationId: response.correlationId,
        externalUserId: null,
        sellerNickname: null,
        matchesConnection: false
      };
    }

    const externalUserId = normalizeMercadoLivreId(response.data.id);
    const sellerNickname = typeof response.data.nickname === "string" ? response.data.nickname : null;
    return {
      ok: true as const,
      endpoint: response.endpoint,
      status: response.status,
      errorCode: null,
      errorMessage: null,
      requestId: response.requestId,
      correlationId: response.correlationId,
      externalUserId,
      sellerNickname,
      matchesConnection: externalUserId === input.expectedExternalUserId
    };
  }

  async fetchSellerItemsReadOnly(input: { organizationId: string; connectionId: string; accessToken: string; externalUserId: string; maxItems?: number; maxPages?: number }) {
    const maxItems = Math.max(1, Math.min(input.maxItems ?? defaultMaxItems, 1000));
    const maxPages = Math.max(1, Math.min(input.maxPages ?? defaultMaxPages, 50));
    const seenIds = new Set<string>();
    const errors: Array<MercadoLivreFetchResult<MercadoLivreItemSearchPayload>> = [];
    const endpoints: Array<Record<string, unknown>> = [];
    const statusSummary: Array<Record<string, unknown>> = [];
    let total: number | null = null;
    let successfulCalls = 0;

    for (const itemStatus of listingStatusFilters) {
      const statusIds = new Set<string>();
      let statusTotal: number | null = null;

      for (let page = 0; page < maxPages && seenIds.size < maxItems; page += 1) {
        const offset = page * defaultPageLimit;
        const path = page === 0 && itemStatus === null
          ? sellerItemsPath({ externalUserId: input.externalUserId })
          : sellerItemsPath({ externalUserId: input.externalUserId, status: itemStatus, offset });
        const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          accessToken: input.accessToken,
          path
        });
        const pageIds = response.ok ? (response.data.results ?? []).map(normalizeMercadoLivreId).filter(Boolean) as string[] : [];
        statusTotal = response.ok && typeof response.data.paging?.total === "number" ? response.data.paging.total : statusTotal;
        endpoints.push({
          endpoint: response.endpoint,
          itemStatus: itemStatusLabel(itemStatus),
          status: response.status,
          total: statusTotal,
          returnedIds: pageIds.length,
          requestId: response.requestId,
          correlationId: response.correlationId,
          errorCode: response.ok ? null : response.error.error,
          errorMessage: response.ok ? null : response.error.message
        });

        if (!response.ok) {
          errors.push(response);
          break;
        }

        successfulCalls += 1;
        total = typeof response.data.paging?.total === "number" && itemStatus === null ? response.data.paging.total : total;
        for (const id of pageIds) {
          statusIds.add(id);
          seenIds.add(id);
        }
        if (!pageIds.length || (statusTotal !== null && statusIds.size >= statusTotal)) break;
      }

      statusSummary.push({
        itemStatus: itemStatusLabel(itemStatus),
        total: statusTotal,
        returnedIds: statusIds.size
      });
      if (seenIds.size >= maxItems) break;
    }

    if (!successfulCalls) {
      return {
        ok: false as const,
        ids: [...seenIds],
        total,
        statusSummary,
        endpoints,
        error: errors[0]
      };
    }

    const ids = [...seenIds].slice(0, maxItems);
    return {
      ok: true as const,
      ids,
      total,
      statusSummary,
      endpoints,
      errors
    };
  }


  async fetchItemsDetailsReadOnly(input: { organizationId: string; connectionId: string; accessToken: string; itemIds: string[] }) {
    const listings: NormalizedListing[] = [];
    const warnings: string[] = [];
    const endpoints: Array<Record<string, unknown>> = [];

    for (const ids of chunk(input.itemIds, itemDetailsChunkSize)) {
      const path = `/items?ids=${ids.map(encodeURIComponent).join(",")}`;
      const response = await fetchMercadoLivreJson<MercadoLivreMultiGetEntry[]>({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        accessToken: input.accessToken,
        path
      });
      endpoints.push({
        endpoint: response.endpoint,
        status: response.status,
        requestId: response.requestId,
        correlationId: response.correlationId,
        errorCode: response.ok ? null : response.error.error,
        errorMessage: response.ok ? null : response.error.message
      });

      if (!response.ok) {
        warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar detalhes de anuncios.`);
        continue;
      }

      for (const entry of response.data) {
        if (entry.code && entry.code !== 200) {
          warnings.push(`Um anuncio Mercado Livre retornou codigo ${entry.code} no detalhe.`);
          continue;
        }
        const normalized = entry.body ? normalizeListing(entry.body) : null;
        if (normalized) listings.push(normalized);
      }
    }

    return { listings, warnings, endpoints };
  }

  async upsertListingCache(input: { organizationId: string; connectionId: string; listings: NormalizedListing[] }) {
    const now = new Date();
    const categoryIds = [...new Set(input.listings.map((listing) => listing.categoryId).filter(Boolean))] as string[];
    const categories = categoryIds.length
      ? await prisma.marketplaceCategoryCatalog.findMany({
          where: { provider: "MERCADO_LIVRE", marketplaceCategoryId: { in: categoryIds } },
          select: { marketplaceCategoryId: true, name: true, path: true }
        })
      : [];
    const categoryById = new Map(categories.map((category) => [category.marketplaceCategoryId, category.path || category.name]));

    let upserted = 0;
    for (const listing of input.listings) {
      await prisma.mercadoLivreListingCache.upsert({
        where: {
          mercadoLivreConnectionId_externalItemId: {
            mercadoLivreConnectionId: input.connectionId,
            externalItemId: listing.externalItemId
          }
        },
        create: {
          organizationId: input.organizationId,
          mercadoLivreConnectionId: input.connectionId,
          externalItemId: listing.externalItemId,
          title: listing.title,
          sku: listing.sku,
          gtin: listing.gtin,
          brand: listing.brand,
          partNumber: listing.partNumber,
          categoryId: listing.categoryId,
          categoryName: listing.categoryId ? categoryById.get(listing.categoryId) ?? null : null,
          price: listing.price === null ? null : new Prisma.Decimal(listing.price),
          currencyId: listing.currencyId,
          status: listing.status,
          permalink: listing.permalink,
          thumbnail: listing.thumbnail,
          rawAttributesJson: listing.rawAttributesJson,
          lastSyncedAt: now
        },
        update: {
          title: listing.title,
          sku: listing.sku,
          gtin: listing.gtin,
          brand: listing.brand,
          partNumber: listing.partNumber,
          categoryId: listing.categoryId,
          categoryName: listing.categoryId ? categoryById.get(listing.categoryId) ?? null : null,
          price: listing.price === null ? null : new Prisma.Decimal(listing.price),
          currencyId: listing.currencyId,
          status: listing.status,
          permalink: listing.permalink,
          thumbnail: listing.thumbnail,
          rawAttributesJson: listing.rawAttributesJson,
          lastSyncedAt: now
        }
      });
      upserted += 1;
    }

    return { upserted, lastSyncedAt: now };
  }

  async startListingsSync(input: { authContext: ListingSyncAuthContext; maxItems?: number; maxPages?: number }) {
    const { connection, accessToken } = await this.getActiveMercadoLivreConnection(input.authContext.organizationId);
    const syncStartedAt = new Date();
    const accountProbe = await this.fetchConnectedUserReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      expectedExternalUserId: connection.externalUserId ?? ""
    });
    const accountWarnings: string[] = [];
    if (!accountProbe.ok) {
      accountWarnings.push("Nao foi possivel validar /users/me nesta execucao read-only.");
    } else if (!accountProbe.matchesConnection) {
      accountWarnings.push("O seller retornado por /users/me nao corresponde ao externalUserId salvo na conexao.");
    }

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "MERCADO_LIVRE_LISTINGS_SYNC_START",
      metadata: {
        connectionId: connection.id,
        externalUserId: connection.externalUserId,
        accountProbeStatus: accountProbe.status,
        accountMatchesConnection: accountProbe.matchesConnection,
        externalWrite: false
      }
    });

    const itemSearch = await this.fetchSellerItemsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      externalUserId: connection.externalUserId ?? "",
      maxItems: input.maxItems,
      maxPages: input.maxPages
    });

    if (!itemSearch.ok) {
      const errorStatus = itemSearch.error?.status ?? 0;
      const errorEndpoint = itemSearch.error?.endpoint ?? "endpoint Mercado Livre";
      const lastError = `Sincronizacao read-only ML retornou HTTP ${errorStatus} em ${errorEndpoint}.`;
      await prisma.mercadoLivreConnection.update({
        where: { id: connection.id },
        data: { lastError }
      });
      await audit({
        organizationId: input.authContext.organizationId,
        userId: input.authContext.user.id,
        action: "MERCADO_LIVRE_LISTINGS_SYNC_ERROR",
        metadata: {
          connectionId: connection.id,
          endpoint: errorEndpoint,
          httpStatus: errorStatus,
          errorCode: itemSearch.error?.ok === false ? itemSearch.error.error.error : null,
          errorMessage: itemSearch.error?.ok === false ? itemSearch.error.error.message : null,
          statusSummary: itemSearch.statusSummary,
          externalWrite: false
        }
      });

      return {
        status: "ERROR",
        connection: toSafeMercadoLivreAccount(connection),
        accountProbe,
        endpoints: itemSearch.endpoints,
        foundItemIds: itemSearch.ids.length,
        statusSummary: itemSearch.statusSummary,
        detailsFetched: 0,
        upserted: 0,
        cacheTotal: await prisma.mercadoLivreListingCache.count({ where: { organizationId: input.authContext.organizationId, mercadoLivreConnectionId: connection.id } }),
        warnings: [...accountWarnings, "Mercado Livre recusou a sincronizacao read-only de anuncios. Nada foi salvo alem do log sanitizado."],
        lastError,
        externalWrite: false
      };
    }

    const details = await this.fetchItemsDetailsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      itemIds: itemSearch.ids
    });
    const cache = await this.upsertListingCache({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      listings: details.listings
    });
    const cacheTotal = await prisma.mercadoLivreListingCache.count({
      where: { organizationId: input.authContext.organizationId, mercadoLivreConnectionId: connection.id }
    });
    const syncWarnings = [
      ...accountWarnings,
      ...(itemSearch.errors.length ? ["Algumas consultas por status retornaram erro sanitizado, mas as demais foram processadas."] : []),
      ...details.warnings
    ];
    if (!itemSearch.ids.length) {
      syncWarnings.push("A conta Mercado Livre conectada nao retornou anuncios para sincronizacao. Verifique se esta e a conta vendedora correta e se ha anuncios ativos, pausados, encerrados ou em revisao.");
    }
    const hasPartialError = itemSearch.errors.length > 0 || details.warnings.length > 0 || accountWarnings.length > 0;

    await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: cache.lastSyncedAt, lastError: hasPartialError ? syncWarnings[0] : null }
    });
    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: hasPartialError ? "MERCADO_LIVRE_LISTINGS_SYNC_ERROR" : "MERCADO_LIVRE_LISTINGS_SYNC_SUCCESS",
      metadata: {
        connectionId: connection.id,
        accountProbeStatus: accountProbe.status,
        accountMatchesConnection: accountProbe.matchesConnection,
        statusSummary: itemSearch.statusSummary,
        foundItemIds: itemSearch.ids.length,
        detailsFetched: details.listings.length,
        upserted: cache.upserted,
        cacheTotal,
        warnings: syncWarnings.length,
        externalWrite: false
      }
    });

    return {
      status: hasPartialError ? "PARTIAL" : "SUCCESS",
      connection: toSafeMercadoLivreAccount(connection),
      accountProbe,
      endpoints: [...itemSearch.endpoints, ...details.endpoints],
      foundItemIds: itemSearch.ids.length,
      totalAvailable: itemSearch.total,
      statusSummary: itemSearch.statusSummary,
      detailsFetched: details.listings.length,
      upserted: cache.upserted,
      cacheTotal,
      lastSyncedAt: cache.lastSyncedAt,
      startedAt: syncStartedAt,
      warnings: syncWarnings,
      externalWrite: false
    };
  }

  async getListingsSyncStatus(authContext: ListingSyncAuthContext) {
    const connection = await mercadoLivreOAuthService.findActiveConnection(authContext.organizationId);
    if (!connection) {
      return {
        connected: false,
        status: "NO_CONNECTION",
        cacheTotal: 0,
        lastSyncedAt: null,
        connection: null,
        lastError: null,
        externalWrite: false
      };
    }

    const [cacheTotal, latest] = await Promise.all([
      prisma.mercadoLivreListingCache.count({ where: { organizationId: authContext.organizationId, mercadoLivreConnectionId: connection.id } }),
      prisma.mercadoLivreListingCache.findFirst({
        where: { organizationId: authContext.organizationId, mercadoLivreConnectionId: connection.id },
        orderBy: { lastSyncedAt: "desc" },
        select: { lastSyncedAt: true }
      })
    ]);

    return {
      connected: true,
      status: connection.status,
      cacheTotal,
      lastSyncedAt: latest?.lastSyncedAt ?? connection.lastSyncAt,
      connection: toSafeMercadoLivreAccount(connection),
      lastError: connection.lastError,
      externalWrite: false
    };
  }

  async searchListingCache(input: { authContext: ListingSyncAuthContext; q?: string | null; gtin?: string | null; searchMode?: string | null; connectionId?: string | null }) {
    const rawQuery = input.gtin?.trim() || input.q?.trim();
    if (!rawQuery) throw new Error("Informe q ou gtin para buscar no Mercado Livre.");

    const connection = await mercadoLivreOAuthService.findActiveConnection(input.authContext.organizationId, input.connectionId);
    if (!connection) throw new Error("Conecte uma conta Mercado Livre antes de buscar.");

    const requestedSearchMode = normalizeMercadoLivreSearchMode(input.searchMode);
    const localLookup = await findLocalProductForMercadoLivreSearch(input.authContext, rawQuery);
    const resolvedSearch = resolveMercadoLivreSearch({
      rawQuery,
      requestedMode: requestedSearchMode,
      localProduct: localLookup.product
    });
    const localProduct = toSafeMercadoLivreSearchProduct(localLookup.product, localLookup.matchType);

    const [cacheTotal, latest] = await Promise.all([
      prisma.mercadoLivreListingCache.count({ where: { organizationId: input.authContext.organizationId, mercadoLivreConnectionId: connection.id } }),
      prisma.mercadoLivreListingCache.findFirst({
        where: { organizationId: input.authContext.organizationId, mercadoLivreConnectionId: connection.id },
        orderBy: { lastSyncedAt: "desc" },
        select: { lastSyncedAt: true }
      })
    ]);

    if (!resolvedSearch.searchValue) {
      return {
        account: toSafeMercadoLivreAccount(connection),
        query: rawQuery,
        requestedSearchMode,
        searchMode: resolvedSearch.searchMode,
        searchType: resolvedSearch.searchType,
        searchValue: null,
        localProduct,
        localProductMatchType: localLookup.matchType,
        mercadoLivreCacheStatus: { total: cacheTotal, lastSyncedAt: latest?.lastSyncedAt ?? null, searched: false },
        warnings: resolvedSearch.warnings,
        readOnly: true,
        externalWrite: false,
        items: []
      };
    }

    let items: Awaited<ReturnType<typeof prisma.mercadoLivreListingCache.findMany>> = [];
    if (resolvedSearch.searchType === "GTIN") {
      const gtin = normalizeGtin(resolvedSearch.searchValue);
      items = gtin
        ? await prisma.mercadoLivreListingCache.findMany({
            where: { organizationId: input.authContext.organizationId, mercadoLivreConnectionId: connection.id, gtin },
            orderBy: { updatedAt: "desc" },
            take: 12
          })
        : [];
    } else {
      const term = resolvedSearch.searchValue.trim();
      const skuHint = localLookup.product?.sku?.trim() || rawQuery.trim();
      items = await prisma.mercadoLivreListingCache.findMany({
        where: {
          organizationId: input.authContext.organizationId,
          mercadoLivreConnectionId: connection.id,
          OR: [
            { title: { contains: term, mode: "insensitive" } },
            ...(skuHint ? [{ sku: { equals: skuHint, mode: "insensitive" } } as const] : [])
          ]
        },
        take: 30
      });
      const normalizedTerm = term.toLowerCase();
      items = items
        .map((item) => {
          const title = item.title.toLowerCase();
          const score = title === normalizedTerm ? 0 : title.startsWith(normalizedTerm) ? 1 : item.sku?.toLowerCase() === skuHint.toLowerCase() ? 2 : 3;
          return { item, score };
        })
        .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
        .slice(0, 12)
        .map(({ item }) => item);
    }

    const warnings = [...resolvedSearch.warnings];
    if (cacheTotal === 0) warnings.push("Nenhuma referencia Mercado Livre local esta disponivel para esta busca.");
    if (cacheTotal > 0 && !items.length) warnings.push("Nenhuma referencia Mercado Livre local corresponde a esta busca.");

    await audit({
      organizationId: input.authContext.organizationId,
      userId: input.authContext.user.id,
      action: "MERCADO_LIVRE_CACHE_SEARCH",
      metadata: {
        connectionId: connection.id,
        searchMode: resolvedSearch.searchMode,
        searchType: resolvedSearch.searchType,
        cacheTotal,
        results: items.length,
        externalWrite: false
      }
    });

    return {
      account: toSafeMercadoLivreAccount(connection),
      query: rawQuery,
      requestedSearchMode,
      searchMode: resolvedSearch.searchMode,
      searchType: resolvedSearch.searchType,
      searchValue: resolvedSearch.searchValue,
      localProduct,
      localProductMatchType: localLookup.matchType,
      mercadoLivreCacheStatus: { total: cacheTotal, lastSyncedAt: latest?.lastSyncedAt ?? null, searched: true },
      warnings,
      apiSearchStatus: "cache",
      readOnly: true,
      externalWrite: false,
      items: items.map(toSafeCacheItem)
    };
  }
}

export const mercadoLivreListingsSyncService = new MercadoLivreListingsSyncService();
