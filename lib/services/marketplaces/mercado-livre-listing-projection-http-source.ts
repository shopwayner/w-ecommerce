import {
  normalizeMercadoLivreClientListing,
  type MercadoLivreItemBody,
  type MercadoLivreMultiGetEntry
} from "@/lib/services/marketplaces/mercado-livre-client-listings-service";
import {
  MercadoLivreCoreRequestError,
  requestMercadoLivreCore
} from "@/lib/services/marketplaces/mercado-livre-core-request";
import { mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";
import {
  MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE,
  MERCADO_LIVRE_PROJECTION_PAGE_SIZE,
  MercadoLivreProjectionSourceValidationError,
  type MercadoLivreProjectionCatalogMetadata,
  type MercadoLivreProjectionCatalogPage,
  type MercadoLivreProjectionSourceContext,
  type MercadoLivreProjectionSourceListingDetail,
  type MercadoLivreProjectionSyncSource
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-source";

const MERCADO_LIVRE_API_BASE_URL = "https://api.mercadolibre.com";
const PROJECTION_HTTP_TIMEOUT_MS = 8_000;

type ProjectionAccessContext = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
  accessToken: string;
};

export interface MercadoLivreProjectionAccessTokenProvider {
  getAccessToken(input: {
    organizationId: string;
    marketplaceConnectionId: string;
    sellerId: string;
    signal: AbortSignal;
  }): Promise<ProjectionAccessContext>;
  refreshAccessToken(input: {
    organizationId: string;
    marketplaceConnectionId: string;
    sellerId: string;
    signal: AbortSignal;
  }): Promise<ProjectionAccessContext>;
}

type MercadoLivreProjectionHttpSourceDependencies = {
  tokenProvider?: MercadoLivreProjectionAccessTokenProvider;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  now?: () => Date;
};

type SellerItemsPayload = {
  seller_id?: unknown;
  results?: unknown;
  paging?: {
    total?: unknown;
    limit?: unknown;
    offset?: unknown;
  };
};

type UserPayload = { id?: unknown };

export class MercadoLivreProjectionHttpSourceError extends MercadoLivreProjectionSourceValidationError {
  constructor(
    code: string,
    readonly status: number,
    readonly endpoint: string
  ) {
    super(code, `Mercado Livre projection request failed: ${code}`);
    this.name = "MercadoLivreProjectionHttpSourceError";
  }
}

function sourceError(code: string, message: string): never {
  throw new MercadoLivreProjectionSourceValidationError(code, message);
}

function requiredSellerId(value: unknown) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!normalized || normalized.length > 191) {
    sourceError("PROJECTION_SOURCE_SELLER_INVALID", "Projection source seller is invalid.");
  }
  return normalized;
}

function requiredItemId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^MLB[0-9]+$/.test(normalized)) {
    sourceError("PROJECTION_CATALOG_ID_INVALID", "Projection source returned an invalid item ID.");
  }
  return normalized;
}

function requiredProjectionText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    sourceError("PROJECTION_DETAIL_INVALID", `Projection detail ${field} is invalid.`);
  }
  return normalized;
}

function requiredInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    sourceError("PROJECTION_SOURCE_RESPONSE_INVALID", `Projection source ${field} is invalid.`);
  }
  return value as number;
}

function validatePayloadSeller(payload: SellerItemsPayload, expectedSellerId: string) {
  if (
    payload.seller_id !== undefined
    && requiredSellerId(payload.seller_id) !== expectedSellerId
  ) {
    sourceError(
      "PROJECTION_SOURCE_SELLER_MISMATCH",
      "Projection source returned an unexpected seller."
    );
  }
}

function buildSellerItemsPath(input: { sellerId: string; offset: number; limit: number }) {
  const query = new URLSearchParams({
    offset: String(input.offset),
    limit: String(input.limit)
  });
  return `/users/${encodeURIComponent(input.sellerId)}/items/search?${query.toString()}`;
}

function safeEndpointLabel(kind: "identity" | "catalog" | "details") {
  if (kind === "identity") return "GET /users/me";
  if (kind === "catalog") return "GET /users/{sellerId}/items/search";
  return "GET /items?ids={batch}";
}

function httpFailureCode(error: MercadoLivreCoreRequestError) {
  if (error.kind === "timeout") return "PROJECTION_HTTP_TIMEOUT";
  if (error.kind === "aborted") return "PROJECTION_HTTP_ABORTED";
  if (error.kind === "unauthorized") return "PROJECTION_HTTP_UNAUTHORIZED";
  if (error.kind === "forbidden") return "PROJECTION_HTTP_FORBIDDEN";
  if (error.kind === "not_found") return "PROJECTION_HTTP_NOT_FOUND";
  if (error.kind === "rate_limited") return "PROJECTION_HTTP_RATE_LIMITED";
  if (error.kind === "external_5xx") return "PROJECTION_HTTP_EXTERNAL_5XX";
  if (error.kind === "invalid_response") return "PROJECTION_HTTP_INVALID_RESPONSE";
  return "PROJECTION_HTTP_FAILED";
}

function nonOkFailureCode(status: number) {
  if (status === 401) return "PROJECTION_HTTP_UNAUTHORIZED";
  if (status === 403) return "PROJECTION_HTTP_FORBIDDEN";
  if (status === 404) return "PROJECTION_HTTP_NOT_FOUND";
  if (status === 429) return "PROJECTION_HTTP_RATE_LIMITED";
  if (status >= 500) return "PROJECTION_HTTP_EXTERNAL_5XX";
  return "PROJECTION_HTTP_FAILED";
}

function assertAccessContext(
  access: ProjectionAccessContext,
  expected: Pick<MercadoLivreProjectionSourceContext, "organizationId" | "marketplaceConnectionId" | "sellerId">
) {
  if (
    access.organizationId !== expected.organizationId
    || access.marketplaceConnectionId !== expected.marketplaceConnectionId
    || access.sellerId !== expected.sellerId
    || !access.accessToken
  ) {
    sourceError(
      "PROJECTION_SOURCE_SCOPE_MISMATCH",
      "Projection access context does not match the requested scope."
    );
  }
  return access;
}

export const mercadoLivreProjectionAccessTokenProvider: MercadoLivreProjectionAccessTokenProvider = {
  async getAccessToken(input) {
    const result = await mercadoLivreClientOAuthService.getAccessTokenForActiveConnection(
      input.organizationId,
      { signal: input.signal }
    );
    const sellerId = requiredSellerId(
      result.connection.sellerId ?? result.connection.externalAccountId
    );
    return assertAccessContext({
      organizationId: result.connection.organizationId,
      marketplaceConnectionId: result.connection.id,
      sellerId,
      accessToken: result.accessToken
    }, input);
  },
  async refreshAccessToken(input) {
    const result = await mercadoLivreClientOAuthService.refreshConnectionToken({
      organizationId: input.organizationId,
      connectionId: input.marketplaceConnectionId,
      signal: input.signal
    });
    const sellerId = requiredSellerId(
      result.connection.sellerId ?? result.connection.externalAccountId
    );
    return assertAccessContext({
      organizationId: result.connection.organizationId,
      marketplaceConnectionId: result.connection.id,
      sellerId,
      accessToken: result.accessToken
    }, input);
  }
};

export class MercadoLivreHttpProjectionSyncSource implements MercadoLivreProjectionSyncSource {
  private access: ProjectionAccessContext | null = null;
  private readonly tokenProvider: MercadoLivreProjectionAccessTokenProvider;
  private readonly apiBaseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly dependencies: MercadoLivreProjectionHttpSourceDependencies = {}) {
    this.tokenProvider = dependencies.tokenProvider ?? mercadoLivreProjectionAccessTokenProvider;
    this.apiBaseUrl = (dependencies.apiBaseUrl ?? MERCADO_LIVRE_API_BASE_URL).replace(/\/$/, "");
    this.requestTimeoutMs = Math.max(1, dependencies.requestTimeoutMs ?? PROJECTION_HTTP_TIMEOUT_MS);
  }

  private async ensureAccess(input: MercadoLivreProjectionSourceContext) {
    if (this.access) return assertAccessContext(this.access, input);
    this.access = assertAccessContext(await this.tokenProvider.getAccessToken({
      organizationId: input.organizationId,
      marketplaceConnectionId: input.marketplaceConnectionId,
      sellerId: input.sellerId,
      signal: input.signal
    }), input);
    return this.access;
  }

  private async requestJson<T>(input: {
    context: MercadoLivreProjectionSourceContext;
    path: string;
    endpoint: string;
  }): Promise<T> {
    const access = await this.ensureAccess(input.context);
    let result;
    try {
      result = await requestMercadoLivreCore({
        url: `${this.apiBaseUrl}${input.path}`,
        endpoint: input.endpoint,
        accessToken: access.accessToken,
        signal: input.context.signal,
        timeoutMs: this.requestTimeoutMs,
        retryTransient: true,
        retryOnUnauthorized: true,
        refreshAccessToken: async () => {
          this.access = assertAccessContext(await this.tokenProvider.refreshAccessToken({
            organizationId: input.context.organizationId,
            marketplaceConnectionId: input.context.marketplaceConnectionId,
            sellerId: input.context.sellerId,
            signal: input.context.signal
          }), input.context);
          return this.access.accessToken;
        },
        fetchImpl: this.dependencies.fetchImpl,
        sleepImpl: this.dependencies.sleepImpl
      });
    } catch (error) {
      if (error instanceof MercadoLivreCoreRequestError) {
        throw new MercadoLivreProjectionHttpSourceError(
          httpFailureCode(error),
          error.status,
          input.endpoint
        );
      }
      throw error;
    }
    this.access = { ...access, accessToken: result.accessToken };
    if (!result.response.ok) {
      throw new MercadoLivreProjectionHttpSourceError(
        nonOkFailureCode(result.response.status),
        result.response.status,
        input.endpoint
      );
    }
    try {
      return JSON.parse(result.body) as T;
    } catch {
      throw new MercadoLivreProjectionHttpSourceError(
        "PROJECTION_HTTP_INVALID_RESPONSE",
        result.response.status,
        input.endpoint
      );
    }
  }

  async resolveIdentity(input: MercadoLivreProjectionSourceContext) {
    const payload = await this.requestJson<UserPayload>({
      context: input,
      path: "/users/me",
      endpoint: safeEndpointLabel("identity")
    });
    return { sellerId: requiredSellerId(payload.id) };
  }

  async getCatalogMetadata(
    input: MercadoLivreProjectionSourceContext
  ): Promise<MercadoLivreProjectionCatalogMetadata> {
    const payload = await this.requestJson<SellerItemsPayload>({
      context: input,
      path: buildSellerItemsPath({ sellerId: input.sellerId, offset: 0, limit: 1 }),
      endpoint: safeEndpointLabel("catalog")
    });
    validatePayloadSeller(payload, input.sellerId);
    return {
      sellerId: input.sellerId,
      total: requiredInteger(payload.paging?.total, "total")
    };
  }

  async listCatalogPage(
    input: MercadoLivreProjectionSourceContext & { offset: number; limit: number }
  ): Promise<MercadoLivreProjectionCatalogPage> {
    if (
      !Number.isSafeInteger(input.offset)
      || input.offset < 0
      || !Number.isSafeInteger(input.limit)
      || input.limit < 1
      || input.limit > MERCADO_LIVRE_PROJECTION_PAGE_SIZE
    ) {
      sourceError("PROJECTION_PAGINATION_INVALID", "Projection page request is invalid.");
    }
    const payload = await this.requestJson<SellerItemsPayload>({
      context: input,
      path: buildSellerItemsPath({
        sellerId: input.sellerId,
        offset: input.offset,
        limit: input.limit
      }),
      endpoint: safeEndpointLabel("catalog")
    });
    validatePayloadSeller(payload, input.sellerId);
    if (!Array.isArray(payload.results)) {
      sourceError("PROJECTION_SOURCE_RESPONSE_INVALID", "Projection source IDs are invalid.");
    }
    const returnedLimit = requiredInteger(payload.paging?.limit, "limit");
    if (returnedLimit !== input.limit) {
      sourceError(
        "PROJECTION_PAGINATION_INVALID",
        "Projection source returned an unexpected page limit."
      );
    }
    return {
      sellerId: input.sellerId,
      total: requiredInteger(payload.paging?.total, "total"),
      offset: requiredInteger(payload.paging?.offset, "offset"),
      ids: payload.results.map(requiredItemId)
    };
  }

  async getListingDetails(
    input: MercadoLivreProjectionSourceContext & { ids: string[] }
  ): Promise<MercadoLivreProjectionSourceListingDetail[]> {
    if (
      !Array.isArray(input.ids)
      || input.ids.length < 1
      || input.ids.length > MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE
    ) {
      sourceError("PROJECTION_DETAIL_BATCH_INVALID", "Projection detail batch is invalid.");
    }
    const requestedIds = input.ids.map(requiredItemId);
    const payload = await this.requestJson<MercadoLivreMultiGetEntry[]>({
      context: input,
      path: `/items?ids=${requestedIds.map(encodeURIComponent).join(",")}`,
      endpoint: safeEndpointLabel("details")
    });
    if (!Array.isArray(payload)) {
      sourceError("PROJECTION_SOURCE_RESPONSE_INVALID", "Projection detail response is invalid.");
    }
    const syncedAt = (this.dependencies.now ?? (() => new Date()))();
    return payload.map((entry) => {
      if (entry?.code !== undefined && entry.code !== 200) {
        sourceError("PROJECTION_DETAIL_HTTP_FAILED", "Projection detail item returned an error.");
      }
      const body = entry?.body;
      if (!body) {
        sourceError("PROJECTION_DETAIL_COVERAGE_MISMATCH", "Projection detail item is missing.");
      }
      return this.normalizeDetail(body, syncedAt);
    });
  }

  private normalizeDetail(
    body: MercadoLivreItemBody,
    syncedAt: Date
  ): MercadoLivreProjectionSourceListingDetail {
    const sellerId = requiredSellerId(body.seller_id);
    const listing = normalizeMercadoLivreClientListing(body, syncedAt);
    if (!listing) {
      sourceError("PROJECTION_DETAIL_INVALID", "Projection detail item is invalid.");
    }
    return {
      sellerId,
      mlbId: requiredItemId(listing.externalId),
      title: listing.title,
      sku: listing.sku,
      gtin: listing.gtin,
      status: requiredProjectionText(listing.status, "status"),
      subStatus: listing.quality.subStatus,
      health: listing.health,
      listingTypeId: requiredProjectionText(listing.listingTypeId, "listingTypeId"),
      availableQuantity: listing.availableQuantity,
      price: listing.price,
      currencyId: listing.currencyId,
      thumbnail: listing.thumbnail,
      categoryId: listing.categoryId,
      permalink: listing.permalink,
      dateCreated: listing.dateCreated,
      remoteUpdatedAt: listing.updatedAt,
      syncedAt
    };
  }
}
