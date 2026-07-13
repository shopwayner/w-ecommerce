export const MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION = 2;
export const MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE = "shipping_options_free_all_country_list_cost";

export type MercadoLivreSellerShippingCost = {
  costAmount: number | null;
  currencyId: string | null;
  source: typeof MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE | null;
  unavailableReason: string | null;
};

export type MercadoLivreSellerShippingCostQuery = {
  organizationId: string;
  connectionId: string;
  sellerId: string;
  itemId: string;
  currencyId: string | null;
  freeShipping: boolean;
  itemPrice: number | null;
  listingTypeId: string | null;
  mode: string | null;
  logisticType: string | null;
};

export type MercadoLivreSellerShippingCostContext = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
  externalItemId: string;
  currencyId: string | null;
  freeShipping: boolean;
  itemPrice: number | null;
  listingTypeId: string | null;
  mode: string | null;
  logisticType: string | null;
};

export type MercadoLivrePersistedSellerShippingCost = MercadoLivreSellerShippingCost & {
  lastUpdatedAt: string;
  stale: boolean;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : value === null ? null : undefined;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : value === null ? null : undefined;
}

export function sellerShippingCostUnavailable(reason = "Custo ainda nao disponivel."): MercadoLivreSellerShippingCost {
  return {
    costAmount: null,
    currencyId: null,
    source: null,
    unavailableReason: reason
  };
}

export function sellerShippingCostContext(input: MercadoLivreSellerShippingCostQuery): MercadoLivreSellerShippingCostContext {
  return {
    organizationId: input.organizationId,
    marketplaceConnectionId: input.connectionId,
    sellerId: input.sellerId,
    externalItemId: input.itemId,
    currencyId: input.currencyId,
    freeShipping: input.freeShipping,
    itemPrice: input.itemPrice,
    listingTypeId: input.listingTypeId,
    mode: input.mode,
    logisticType: input.logisticType
  };
}

export function sellerShippingCostCacheKey(input: MercadoLivreSellerShippingCostQuery) {
  const context = sellerShippingCostContext(input);
  return [
    context.organizationId,
    context.marketplaceConnectionId,
    context.sellerId,
    context.externalItemId,
    context.currencyId ?? "",
    context.freeShipping ? "free" : "paid",
    context.itemPrice ?? "",
    context.listingTypeId ?? "",
    context.mode ?? "",
    context.logisticType ?? ""
  ].join(":");
}

export function sellerShippingCostPath(input: MercadoLivreSellerShippingCostQuery) {
  const params = new URLSearchParams();
  params.set("item_id", input.itemId);
  params.set("free_shipping", String(input.freeShipping));
  params.set("verbose", "true");
  if (input.currencyId) params.set("currency_id", input.currencyId);
  if (input.itemPrice !== null) params.set("item_price", String(input.itemPrice));
  if (input.listingTypeId) params.set("listing_type_id", input.listingTypeId);
  if (input.mode) params.set("mode", input.mode);
  if (input.logisticType) params.set("logistic_type", input.logisticType);
  return `/users/${encodeURIComponent(input.sellerId)}/shipping_options/free?${params.toString()}`;
}

export function normalizeSellerShippingCost(payload: unknown, fallbackCurrencyId: string | null): MercadoLivreSellerShippingCost {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return sellerShippingCostUnavailable();
  }

  const coverage = (payload as Record<string, unknown>).coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    return sellerShippingCostUnavailable();
  }

  const allCountry = (coverage as Record<string, unknown>).all_country;
  if (!allCountry || typeof allCountry !== "object" || Array.isArray(allCountry)) {
    return sellerShippingCostUnavailable();
  }

  const allCountryRecord = allCountry as Record<string, unknown>;
  const costAmount = finiteNumber(allCountryRecord.list_cost);
  if (costAmount === null || costAmount < 0) {
    return sellerShippingCostUnavailable();
  }

  return {
    costAmount,
    currencyId: typeof allCountryRecord.currency_id === "string" ? allCountryRecord.currency_id : fallbackCurrencyId,
    source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
    unavailableReason: null
  };
}

export function buildPersistedSellerShippingCost(input: {
  query: MercadoLivreSellerShippingCostQuery;
  costAmount: number | null;
  currencyId: string | null;
  lastUpdatedAt: string | null;
  stale: boolean;
  unavailableReason: string | null;
}) {
  const confirmed = typeof input.costAmount === "number" && Number.isFinite(input.costAmount) && input.costAmount >= 0 && Boolean(input.lastUpdatedAt);
  return {
    version: MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION,
    marketplaceListingId: input.query.itemId,
    amount: confirmed ? input.costAmount : null,
    currencyId: input.currencyId,
    source: confirmed ? MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE : null,
    lastUpdatedAt: confirmed ? input.lastUpdatedAt : null,
    stale: confirmed ? input.stale : false,
    unavailableReason: input.unavailableReason,
    context: sellerShippingCostContext(input.query)
  };
}

export function readCompatiblePersistedSellerShippingCost(
  value: unknown,
  query: MercadoLivreSellerShippingCostQuery
): MercadoLivrePersistedSellerShippingCost | null {
  const persisted = record(value);
  const context = record(persisted?.context);
  if (!persisted || !context) return null;
  if (persisted.version !== MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION) return null;
  if (persisted.source !== MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE) return null;
  if (persisted.marketplaceListingId !== query.itemId) return null;

  const expected = sellerShippingCostContext(query);
  if (context.organizationId !== expected.organizationId) return null;
  if (context.marketplaceConnectionId !== expected.marketplaceConnectionId) return null;
  if (context.sellerId !== expected.sellerId) return null;
  if (context.externalItemId !== expected.externalItemId) return null;
  if (nullableString(context.currencyId) !== expected.currencyId) return null;
  if (context.freeShipping !== expected.freeShipping) return null;
  if (nullableNumber(context.itemPrice) !== expected.itemPrice) return null;
  if (nullableString(context.listingTypeId) !== expected.listingTypeId) return null;
  if (nullableString(context.mode) !== expected.mode) return null;
  if (nullableString(context.logisticType) !== expected.logisticType) return null;

  const costAmount = finiteNumber(persisted.amount);
  const lastUpdatedAt = typeof persisted.lastUpdatedAt === "string" && !Number.isNaN(Date.parse(persisted.lastUpdatedAt)) ? persisted.lastUpdatedAt : null;
  if (costAmount === null || costAmount < 0 || !lastUpdatedAt) return null;

  return {
    costAmount,
    currencyId: nullableString(persisted.currencyId) ?? query.currencyId,
    source: MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
    unavailableReason: typeof persisted.unavailableReason === "string" ? persisted.unavailableReason : null,
    lastUpdatedAt,
    stale: persisted.stale === true
  };
}
