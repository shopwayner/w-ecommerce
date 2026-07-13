import type { Prisma } from "@prisma/client";
import { MarketplaceCategoryProvider, MarketplaceProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";
import {
  buildPersistedSellerShippingCost,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION,
  MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE,
  normalizeSellerShippingCost,
  readCompatiblePersistedSellerShippingCost,
  sellerShippingCostCacheKey,
  sellerShippingCostPath,
  sellerShippingCostUnavailable,
  type MercadoLivreSellerShippingCost,
  type MercadoLivreSellerShippingCostQuery
} from "@/lib/services/marketplaces/mercado-livre-shipping-cost";
import { sanitizeLogPayload } from "@/lib/utils";

const apiBaseUrl = "https://api.mercadolibre.com";
const defaultLimit = 50;
const maxLimit = 100;
const globalSearchMaxListings = 500;
const detailsChunkSize = 20;
const feeEstimateConcurrency = 6;
const feeEstimateTimeoutMs = 5000;
const shippingEstimateConcurrency = 6;
const shippingEstimateTimeoutMs = 5000;
const shippingEstimateCacheTtlMs = 15 * 60 * 1000;
const shippingEstimateUnavailableCacheTtlMs = 30 * 1000;
const listingStatuses = ["active", "paused", "closed", "under_review"] as const;
const cacheRefreshStatusFilters = [undefined, ...listingStatuses] as const;
const listingStatusFilters = ["all", "active", "paused", "closed", "under_review", "error"] as const;
const listingTypeFilters = ["all", "premium", "classico", "other"] as const;
const stockFilters = ["all", "with_stock", "without_stock"] as const;

type ClientAuthContext = {
  organizationId: string;
  user: {
    id: string;
  };
};

type ListingStatusFilter = (typeof listingStatuses)[number];
type ListingFilterStatus = (typeof listingStatusFilters)[number];
type ListingTypeFilter = (typeof listingTypeFilters)[number];
type StockFilter = (typeof stockFilters)[number];

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
  value_struct?: {
    number?: number | string | null;
    unit?: string | null;
  } | null;
  values?: Array<{
    name?: string | null;
    struct?: {
      number?: number | string | null;
      unit?: string | null;
    } | null;
  }>;
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
  local_pick_up?: boolean;
  tags?: string[];
  dimensions?: string | null;
  package_dimensions?: string | null;
  cost?: number | null;
  list_cost?: number | null;
  base_cost?: number | null;
  shipping_cost?: number | null;
  amount?: number | null;
  currency_id?: string | null;
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
  status_detail?: string | { message?: string | null; description?: string | null } | null;
  sub_status?: string[];
  tags?: string[];
  warnings?: Array<string | { code?: string | null; message?: string | null }>;
  attributes?: MercadoLivreAttribute[];
  pictures?: MercadoLivrePicture[];
  shipping?: MercadoLivreShipping;
  dimensions?: string | null;
  package_dimensions?: string | null;
  selling_fee_amount?: number | null;
  listing_fee_amount?: number | null;
  sale_fee?: number | null;
  sale_fee_amount?: number | null;
  commission?: number | null;
  fees?: {
    selling_fee_amount?: number | null;
    listing_fee_amount?: number | null;
    sale_fee?: number | null;
    sale_fee_amount?: number | null;
    commission?: number | null;
  } | null;
  variations?: MercadoLivreVariation[];
  last_updated?: string;
  date_created?: string;
};

type MercadoLivreListingPriceEntry = {
  listing_type_id?: string | null;
  currency_id?: string | null;
  listing_fee_amount?: number | null;
  sale_fee_amount?: number | null;
  selling_fee_amount?: number | null;
  fee_amount?: number | null;
  sale_fee_details?: {
    percentage_fee?: number | null;
    meli_percentage_fee?: number | null;
    fixed_fee?: number | null;
    gross_amount?: number | null;
  } | null;
  commission?: number | null;
};

type ListingFeeEstimate = {
  feeAmount: number | null;
  feePercentage: number | null;
  currencyId: string | null;
  source: "mercado_livre_listing_prices" | null;
  unavailableReason: string | null;
};

type ListingShippingCostEstimate = MercadoLivreSellerShippingCost & {
  fetchedAt: string | null;
  stale: boolean;
};

type CachedShippingCostEstimate = {
  estimate: ListingShippingCostEstimate;
  expiresAt: number;
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
  categoryName: string | null;
  categoryPath: string | null;
  attributes: Array<{
    id: string | null;
    name: string;
    value: string;
  }>;
  dimensions: string | null;
  dimensionInfo: {
    raw: string | null;
    heightCm: string | null;
    widthCm: string | null;
    lengthCm: string | null;
    weightG: string | null;
    hasDimensions: boolean;
    source?: string | null;
    rawSummary?: string | null;
  };
  shipping: {
    mode: string | null;
    logisticType: string | null;
    freeShipping: boolean | null;
    localPickUp: boolean | null;
    tags: string[];
    costAmount: number | null;
    currencyId: string | null;
    costSource: string | null;
    costUnavailableReason: string | null;
    costLastUpdatedAt: string | null;
    costStale: boolean;
  } | null;
  fees: {
    sellingFeeAmount: number | null;
    listingFeeAmount: number | null;
    saleFeeAmount: number | null;
    commissionPercent: number | null;
    currencyId: string | null;
    source: string | null;
    unavailableReason: string | null;
  };
  localProduct: {
    found: boolean;
    name: string | null;
    sku: string | null;
    ean: string | null;
    costPrice: number | null;
    salePrice: number | null;
    availableQuantity: number | null;
    matchBy: "sku" | "gtin" | null;
  };
  estimatedMargin: {
    status: "not_calculated" | "partial";
    label: string;
    price: number | null;
    costPrice: number | null;
    feeAmount: number | null;
    taxStatus: string;
    estimatedProfit: number | null;
    estimatedMarginPercent: number | null;
    missingData: string[];
  };
  quality: {
    health: number | null;
    statusDetail: string | null;
    subStatus: string[];
    tags: string[];
    warnings: string[];
  };
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
const feeEstimateCache = new Map<string, ListingFeeEstimate>();
const shippingEstimateCache = new Map<string, CachedShippingCostEstimate>();

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

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const normalized = finiteNumber(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeStringList(values: unknown) {
  return Array.isArray(values)
    ? values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

function normalizeWarnings(values: MercadoLivreItemBody["warnings"]) {
  if (!Array.isArray(values)) return [];
  return values
    .map((warning) => {
      if (typeof warning === "string") return warning.trim();
      return warning?.message?.trim() || warning?.code?.trim() || "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeStatusDetail(value: MercadoLivreItemBody["status_detail"]) {
  if (typeof value === "string") return value.trim() || null;
  return value?.message?.trim() || value?.description?.trim() || null;
}

function emptyDimensionInfo(): MercadoLivreClientListing["dimensionInfo"] {
  return {
    raw: null,
    heightCm: null,
    widthCm: null,
    lengthCm: null,
    weightG: null,
    hasDimensions: false,
    source: null,
    rawSummary: null
  };
}

function normalizeDimensionNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .replace(",", ".")
            .match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN
        );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDimensionText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeDimensionAttributeId(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function dimensionLengthToCm(value: { number: number; unit: string | null }) {
  const unit = normalizeDimensionText(value.unit);
  if (unit === "mm" || unit.includes("milimetro")) return value.number / 10;
  if (unit === "m" || unit.includes("metro")) return value.number * 100;
  return value.number;
}

function dimensionWeightToGrams(value: { number: number; unit: string | null }) {
  const unit = normalizeDimensionText(value.unit);
  if (unit === "kg" || unit.includes("quilo")) return value.number * 1000;
  if (unit === "mg" || unit.includes("miligrama")) return value.number / 1000;
  return value.number;
}

function dimensionComponent(value: number | null, unit: "cm" | "g") {
  if (value === null) return null;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted} ${unit}`;
}

function hasCompleteDimensionValues(input: Pick<MercadoLivreClientListing["dimensionInfo"], "heightCm" | "widthCm" | "lengthCm" | "weightG">) {
  return [input.widthCm, input.heightCm, input.lengthCm, input.weightG].every((value) => normalizeDimensionNumber(value) !== null);
}

function dimensionAttributeValue(attribute: MercadoLivreAttribute) {
  const structuredNumber = normalizeDimensionNumber(attribute.value_struct?.number);
  if (structuredNumber !== null) {
    return { number: structuredNumber, unit: attribute.value_struct?.unit ?? null };
  }

  for (const value of attribute.values ?? []) {
    const valueNumber = normalizeDimensionNumber(value.struct?.number);
    if (valueNumber !== null) {
      return { number: valueNumber, unit: value.struct?.unit ?? null };
    }
  }

  const raw = attribute.value_name ?? attribute.values?.find((value) => value.name)?.name ?? null;
  const match = raw?.match(/([\d]+(?:[,.]\d+)?)\s*([A-Za-zÀ-ÿ]+)?/);
  const rawNumber = normalizeDimensionNumber(match?.[1]);
  return rawNumber === null ? null : { number: rawNumber, unit: match?.[2] ?? null };
}

const widthDimensionAttributeIds = new Set(["PACKAGE_WIDTH", "SELLER_PACKAGE_WIDTH", "WIDTH"]);
const heightDimensionAttributeIds = new Set(["PACKAGE_HEIGHT", "SELLER_PACKAGE_HEIGHT", "HEIGHT"]);
const lengthDimensionAttributeIds = new Set(["PACKAGE_LENGTH", "SELLER_PACKAGE_LENGTH", "LENGTH", "DEPTH", "PACKAGE_DEPTH", "SELLER_PACKAGE_DEPTH"]);
const weightDimensionAttributeIds = new Set(["PACKAGE_WEIGHT", "SELLER_PACKAGE_WEIGHT", "WEIGHT"]);

function dimensionKindForListingAttribute(attribute: MercadoLivreAttribute) {
  const id = normalizeDimensionAttributeId(attribute.id);
  if (id === "SELLER_PACKAGE_HEIGHT") return "widthCm" as const;
  if (id === "SELLER_PACKAGE_WIDTH") return "heightCm" as const;
  if (widthDimensionAttributeIds.has(id)) return "widthCm" as const;
  if (heightDimensionAttributeIds.has(id)) return "heightCm" as const;
  if (lengthDimensionAttributeIds.has(id)) return "lengthCm" as const;
  if (weightDimensionAttributeIds.has(id)) return "weightG" as const;

  const name = normalizeDimensionText(attribute.name);
  if (name.includes("peso") && (name.includes("embalagem") || name.includes("pacote"))) return "weightG" as const;
  if (name.includes("largura") && (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))) return "widthCm" as const;
  if (name.includes("altura") && (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))) return "heightCm" as const;
  if (
    (name.includes("comprimento") || name.includes("profundidade")) &&
    (name.includes("embalagem") || name.includes("pacote") || name.includes("produto"))
  ) {
    return "lengthCm" as const;
  }
  return null;
}

function dimensionSourceFromAttribute(attribute: MercadoLivreAttribute) {
  const id = normalizeDimensionAttributeId(attribute.id);
  if (id.startsWith("SELLER_PACKAGE_")) return "attributes.SELLER_PACKAGE_*";
  if (id.startsWith("PACKAGE_")) return "attributes.PACKAGE_*";
  return "attributes.WIDTH_HEIGHT_LENGTH";
}

function dimensionsFromListingAttributes(attributes: MercadoLivreAttribute[]): MercadoLivreClientListing["dimensionInfo"] {
  const parsed = emptyDimensionInfo();

  for (const attribute of attributes) {
    const kind = dimensionKindForListingAttribute(attribute);
    if (!kind || parsed[kind] !== null) continue;

    const value = dimensionAttributeValue(attribute);
    if (!value) continue;

    const normalizedValue = kind === "weightG" ? normalizeDimensionNumber(dimensionWeightToGrams(value)) : normalizeDimensionNumber(dimensionLengthToCm(value));
    if (normalizedValue === null) continue;

    parsed[kind] = dimensionComponent(normalizedValue, kind === "weightG" ? "g" : "cm");
    parsed.source = parsed.source ?? dimensionSourceFromAttribute(attribute);
  }

  parsed.hasDimensions = hasCompleteDimensionValues(parsed);
  if (parsed.hasDimensions) {
    const width = normalizeDimensionNumber(parsed.widthCm);
    const height = normalizeDimensionNumber(parsed.heightCm);
    const length = normalizeDimensionNumber(parsed.lengthCm);
    const weight = normalizeDimensionNumber(parsed.weightG);
    parsed.raw = `${width}x${height}x${length},${weight}`;
    parsed.rawSummary = [parsed.widthCm, parsed.heightCm, parsed.lengthCm, parsed.weightG].join(" x ");
  }

  return parsed;
}

function normalizeDimensions(raw: string | null | undefined, source: string | null = "dimensions"): MercadoLivreClientListing["dimensionInfo"] {
  const normalizedRaw = raw?.trim() || null;
  if (!normalizedRaw) {
    return emptyDimensionInfo();
  }

  const match = normalizedRaw.match(/^([\d.,]+)x([\d.,]+)x([\d.,]+),([\d.,]+)$/i);
  if (!match) {
    return { ...emptyDimensionInfo(), raw: normalizedRaw, source };
  }

  const parsed = {
    raw: normalizedRaw,
    heightCm: `${match[1].replace(",", ".")} cm`,
    widthCm: `${match[2].replace(",", ".")} cm`,
    lengthCm: `${match[3].replace(",", ".")} cm`,
    weightG: `${match[4].replace(",", ".")} g`,
    hasDimensions: false,
    source,
    rawSummary: `${match[2].replace(",", ".")} cm x ${match[1].replace(",", ".")} cm x ${match[3].replace(",", ".")} cm x ${match[4].replace(",", ".")} g`
  };
  parsed.hasDimensions = hasCompleteDimensionValues(parsed);
  return parsed;
}

function rawDimensionCandidate(item: MercadoLivreItemBody) {
  const candidates = [
    { value: item.shipping?.dimensions, source: "shipping.dimensions" },
    { value: item.shipping?.package_dimensions, source: "shipping.package_dimensions" },
    { value: item.package_dimensions, source: "package_dimensions" },
    { value: item.dimensions, source: "dimensions" }
  ];

  for (const candidate of candidates) {
    if (typeof candidate.value === "string" && candidate.value.trim()) {
      return { value: candidate.value.trim(), source: candidate.source };
    }
  }

  return { value: null, source: null };
}

function normalizeFees(item: MercadoLivreItemBody, currencyId: string | null): MercadoLivreClientListing["fees"] {
  const sellingFeeAmount = firstFiniteNumber(item.selling_fee_amount, item.fees?.selling_fee_amount);
  const listingFeeAmount = firstFiniteNumber(item.listing_fee_amount, item.fees?.listing_fee_amount);
  const saleFeeAmount = firstFiniteNumber(item.sale_fee_amount, item.sale_fee, item.fees?.sale_fee_amount, item.fees?.sale_fee);
  const commissionPercent = firstFiniteNumber(item.commission, item.fees?.commission);
  const source = sellingFeeAmount !== null || listingFeeAmount !== null || saleFeeAmount !== null || commissionPercent !== null ? "/items" : null;
  return {
    sellingFeeAmount,
    listingFeeAmount,
    saleFeeAmount,
    commissionPercent,
    currencyId,
    source,
    unavailableReason: null
  };
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
  const currencyId = typeof item.currency_id === "string" ? item.currency_id : null;
  const rawDimensions = rawDimensionCandidate(item);
  const directDimensionInfo = normalizeDimensions(rawDimensions.value, rawDimensions.source);
  const attributeDimensionInfo = dimensionsFromListingAttributes(attributes);
  const dimensionInfo = directDimensionInfo.hasDimensions ? directDimensionInfo : attributeDimensionInfo;

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
    price: finiteNumber(item.price),
    currencyId,
    availableQuantity: typeof item.available_quantity === "number" && Number.isFinite(item.available_quantity) ? item.available_quantity : null,
    health: typeof item.health === "number" && Number.isFinite(item.health) ? item.health : null,
    permalink: typeof item.permalink === "string" ? item.permalink : null,
    soldQuantity: typeof item.sold_quantity === "number" && Number.isFinite(item.sold_quantity) ? item.sold_quantity : null,
    visits: null,
    categoryId: typeof item.category_id === "string" ? item.category_id : null,
    categoryName: null,
    categoryPath: null,
    attributes: normalizeItemAttributes(item),
    dimensions: dimensionInfo.raw ?? rawDimensions.value,
    dimensionInfo,
    shipping: item.shipping
      ? {
          mode: typeof item.shipping.mode === "string" ? item.shipping.mode : null,
          logisticType: typeof item.shipping.logistic_type === "string" ? item.shipping.logistic_type : null,
          freeShipping: typeof item.shipping.free_shipping === "boolean" ? item.shipping.free_shipping : null,
          localPickUp: typeof item.shipping.local_pick_up === "boolean" ? item.shipping.local_pick_up : null,
          tags: normalizeStringList(item.shipping.tags),
          costAmount: null,
          currencyId: typeof item.shipping.currency_id === "string" ? item.shipping.currency_id : currencyId,
          costSource: null,
          costUnavailableReason: "Custo ainda nao disponivel.",
          costLastUpdatedAt: null,
          costStale: false
        }
      : null,
    fees: normalizeFees(item, currencyId),
    localProduct: emptyLocalProduct(),
    estimatedMargin: notCalculatedMargin(finiteNumber(item.price), null, null, ["Custo local", "Tarifa ML", "Regra fiscal"]),
    quality: {
      health: typeof item.health === "number" && Number.isFinite(item.health) ? item.health : null,
      statusDetail: normalizeStatusDetail(item.status_detail),
      subStatus: normalizeStringList(item.sub_status),
      tags: normalizeStringList(item.tags),
      warnings: normalizeWarnings(item.warnings)
    },
    dateCreated: typeof item.date_created === "string" ? item.date_created : null,
    updatedAt,
    lastSyncAt: syncedAt.toISOString()
  };
}

function emptyLocalProduct(): MercadoLivreClientListing["localProduct"] {
  return {
    found: false,
    name: null,
    sku: null,
    ean: null,
    costPrice: null,
    salePrice: null,
    availableQuantity: null,
    matchBy: null
  };
}

function notCalculatedMargin(price: number | null, costPrice: number | null, feeAmount: number | null, missingData: string[]): MercadoLivreClientListing["estimatedMargin"] {
  return {
    status: "not_calculated",
    label: "Nao calculado",
    price,
    costPrice,
    feeAmount,
    taxStatus: "Aguardando regra fiscal",
    estimatedProfit: null,
    estimatedMarginPercent: null,
    missingData
  };
}

function buildEstimatedMargin(input: {
  price: number | null;
  costPrice: number | null;
  feeAmount: number | null;
}): MercadoLivreClientListing["estimatedMargin"] {
  const missingData: string[] = [];
  if (input.price === null) missingData.push("Preco ML");
  if (input.costPrice === null) missingData.push("Custo local");
  if (input.feeAmount === null) missingData.push("Tarifa ML");
  missingData.push("Regra fiscal");

  if (input.price === null || input.costPrice === null) {
    return notCalculatedMargin(input.price, input.costPrice, input.feeAmount, missingData);
  }

  if (input.feeAmount === null) {
    return {
      status: "partial",
      label: "Aguardando tarifa",
      price: input.price,
      costPrice: input.costPrice,
      feeAmount: null,
      taxStatus: "Aguardando regra fiscal",
      estimatedProfit: null,
      estimatedMarginPercent: null,
      missingData
    };
  }

  const estimatedProfit = input.price - input.costPrice - input.feeAmount;
  const estimatedMarginPercent = input.price > 0 ? (estimatedProfit / input.price) * 100 : null;

  return {
    status: "partial",
    label: "Parcial",
    price: input.price,
    costPrice: input.costPrice,
    feeAmount: input.feeAmount,
    taxStatus: "Aguardando regra fiscal",
    estimatedProfit,
    estimatedMarginPercent,
    missingData
  };
}

function feeEstimateUnavailable(reason = "Tarifa nao retornada pela API nesta consulta."): ListingFeeEstimate {
  return {
    feeAmount: null,
    feePercentage: null,
    currencyId: null,
    source: null,
    unavailableReason: reason
  };
}

function feeEstimateCacheKey(input: {
  siteId: string;
  categoryId: string;
  listingTypeId: string;
  price: number;
  currencyId: string | null;
}) {
  return [input.siteId, input.categoryId, input.listingTypeId, input.price.toFixed(2), input.currencyId ?? ""].join(":");
}

function listingPricesPath(input: {
  siteId: string;
  categoryId: string;
  listingTypeId: string;
  price: number;
  currencyId: string | null;
}) {
  const params = new URLSearchParams();
  params.set("price", input.price.toFixed(2));
  params.set("listing_type_id", input.listingTypeId);
  params.set("category_id", input.categoryId);
  if (input.currencyId) params.set("currency_id", input.currencyId);
  return `/sites/${encodeURIComponent(input.siteId)}/listing_prices?${params.toString()}`;
}

function normalizeListingPriceEntries(payload: unknown) {
  if (Array.isArray(payload)) return payload as MercadoLivreListingPriceEntry[];
  if (payload && typeof payload === "object") {
    const record = payload as { prices?: unknown };
    if (Array.isArray(record.prices)) return record.prices as MercadoLivreListingPriceEntry[];
    return [payload as MercadoLivreListingPriceEntry];
  }
  return [];
}

function normalizeListingFeeEstimate(payload: unknown, input: { listingTypeId: string; price: number }): ListingFeeEstimate {
  const entries = normalizeListingPriceEntries(payload);
  const matched = entries.find((entry) => entry.listing_type_id === input.listingTypeId) ?? entries[0] ?? null;
  if (!matched) return feeEstimateUnavailable();

  const explicitFeeAmount = firstFiniteNumber(
    matched.sale_fee_amount,
    matched.selling_fee_amount,
    matched.fee_amount
  );
  const apiPercentage = firstFiniteNumber(matched.sale_fee_details?.percentage_fee, matched.sale_fee_details?.meli_percentage_fee, matched.commission);
  const feeAmount = explicitFeeAmount ?? (apiPercentage !== null && input.price > 0 ? (input.price * apiPercentage) / 100 : null);
  const feePercentage = apiPercentage ?? (feeAmount !== null && input.price > 0 ? (feeAmount / input.price) * 100 : null);

  if (feeAmount === null && feePercentage === null) return feeEstimateUnavailable();

  return {
    feeAmount,
    feePercentage,
    currencyId: typeof matched.currency_id === "string" ? matched.currency_id : null,
    source: "mercado_livre_listing_prices",
    unavailableReason: null
  };
}

async function getListingFeeEstimate(input: {
  accessToken: string;
  siteId: string;
  categoryId: string | null;
  listingTypeId: string | null;
  price: number | null;
  currencyId: string | null;
}) {
  if (!input.categoryId || !input.listingTypeId || input.price === null || input.price <= 0) {
    return feeEstimateUnavailable("Dados insuficientes para consultar tarifa.");
  }

  const cacheKey = feeEstimateCacheKey({
    siteId: input.siteId,
    categoryId: input.categoryId,
    listingTypeId: input.listingTypeId,
    price: input.price,
    currencyId: input.currencyId
  });
  const cached = feeEstimateCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), feeEstimateTimeoutMs);

  try {
    const path = listingPricesPath({
      siteId: input.siteId,
      categoryId: input.categoryId,
      listingTypeId: input.listingTypeId,
      price: input.price,
      currencyId: input.currencyId
    });
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const unavailable = feeEstimateUnavailable();
      feeEstimateCache.set(cacheKey, unavailable);
      return unavailable;
    }

    const estimate = normalizeListingFeeEstimate(await response.json(), {
      listingTypeId: input.listingTypeId,
      price: input.price
    });
    feeEstimateCache.set(cacheKey, estimate);
    return estimate;
  } catch {
    const unavailable = feeEstimateUnavailable();
    feeEstimateCache.set(cacheKey, unavailable);
    return unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

function shippingCostEstimateUnavailable(reason = "Frete nao retornado pela API nesta consulta."): ListingShippingCostEstimate {
  return {
    ...sellerShippingCostUnavailable(reason),
    fetchedAt: null,
    stale: false
  };
}

function preserveStaleShippingCost(candidates: Array<ListingShippingCostEstimate | undefined>, unavailable: ListingShippingCostEstimate) {
  const previous = candidates.find(
    (candidate) =>
      typeof candidate?.costAmount === "number" &&
      candidate.source === MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE &&
      typeof candidate.fetchedAt === "string"
  );
  if (!previous) return unavailable;
  return { ...previous, stale: true, unavailableReason: unavailable.unavailableReason };
}

function listingShippingCostQuery(input: {
  organizationId: string;
  connectionId: string;
  sellerId: string;
  listing: MercadoLivreClientListing;
}): MercadoLivreSellerShippingCostQuery | null {
  if (!input.listing.shipping || typeof input.listing.shipping.freeShipping !== "boolean") return null;
  return {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    sellerId: input.sellerId,
    itemId: input.listing.itemId,
    currencyId: input.listing.shipping.currencyId ?? input.listing.currencyId,
    freeShipping: input.listing.shipping.freeShipping,
    itemPrice: input.listing.price,
    listingTypeId: input.listing.listingTypeId,
    mode: input.listing.shipping.mode,
    logisticType: input.listing.shipping.logisticType
  };
}

async function getListingShippingCostEstimate(input: {
  accessToken: string;
  query: MercadoLivreSellerShippingCostQuery;
  persistedEstimate?: ListingShippingCostEstimate;
}) {
  const query = input.query;
  const cacheKey = sellerShippingCostCacheKey(query);
  const cached = shippingEstimateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.estimate;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), shippingEstimateTimeoutMs);

  try {
    const path = sellerShippingCostPath(query);
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const reason = response.status === 429 ? "Custo temporariamente indisponivel." : "Custo ainda nao disponivel.";
      const unavailable = preserveStaleShippingCost([cached?.estimate, input.persistedEstimate], shippingCostEstimateUnavailable(reason));
      shippingEstimateCache.set(cacheKey, {
        estimate: unavailable,
        expiresAt: Date.now() + shippingEstimateUnavailableCacheTtlMs
      });
      return unavailable;
    }

    const normalized = normalizeSellerShippingCost(await response.json(), query.currencyId);
    const now = new Date().toISOString();
    const estimate: ListingShippingCostEstimate = {
      ...normalized,
      fetchedAt: typeof normalized.costAmount === "number" ? now : null,
      stale: false
    };
    const resolved =
      typeof estimate.costAmount === "number" ? estimate : preserveStaleShippingCost([cached?.estimate, input.persistedEstimate], estimate);
    shippingEstimateCache.set(cacheKey, {
      estimate: resolved,
      expiresAt: Date.now() + (typeof resolved.costAmount === "number" && !resolved.stale ? shippingEstimateCacheTtlMs : shippingEstimateUnavailableCacheTtlMs)
    });
    return resolved;
  } catch {
    const unavailable = preserveStaleShippingCost(
      [cached?.estimate, input.persistedEstimate],
      shippingCostEstimateUnavailable("Custo temporariamente indisponivel.")
    );
    shippingEstimateCache.set(cacheKey, {
      estimate: unavailable,
      expiresAt: Date.now() + shippingEstimateUnavailableCacheTtlMs
    });
    return unavailable;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPersistedShippingCostEstimates(input: {
  organizationId: string;
  connectionId: string;
  sellerId: string;
  listings: MercadoLivreClientListing[];
}) {
  const listingsById = new Map(input.listings.map((listing) => [listing.externalId, listing]));
  if (!listingsById.size) return new Map<string, ListingShippingCostEstimate>();

  const rows = await prisma.mercadoLivreListingCache.findMany({
    where: {
      organizationId: input.organizationId,
      externalItemId: { in: Array.from(listingsById.keys()) }
    },
    orderBy: { lastSyncedAt: "desc" },
    select: { externalItemId: true, rawAttributesJson: true }
  });
  const estimates = new Map<string, ListingShippingCostEstimate>();

  for (const row of rows) {
    if (estimates.has(row.externalItemId)) continue;
    const listing = listingsById.get(row.externalItemId);
    if (!listing) continue;
    const query = listingShippingCostQuery({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      sellerId: input.sellerId,
      listing
    });
    if (!query) continue;
    const persisted = readCompatiblePersistedSellerShippingCost(jsonRecord(row.rawAttributesJson)?.sellerShippingCost, query);
    if (!persisted) continue;
    estimates.set(row.externalItemId, {
      costAmount: persisted.costAmount,
      currencyId: persisted.currencyId,
      source: persisted.source,
      unavailableReason: persisted.unavailableReason,
      fetchedAt: persisted.lastUpdatedAt,
      stale: true
    });
  }

  return estimates;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function enrichListingFeesReadOnly(input: {
  accessToken: string;
  siteId: string;
  listings: MercadoLivreClientListing[];
}) {
  if (!input.listings.length) return input.listings;

  return mapWithConcurrency(input.listings, feeEstimateConcurrency, async (listing) => {
    const existingFeeAmount = listing.fees.sellingFeeAmount ?? listing.fees.saleFeeAmount ?? listing.fees.listingFeeAmount;
    if (existingFeeAmount !== null || listing.fees.commissionPercent !== null) return listing;

    const estimate = await getListingFeeEstimate({
      accessToken: input.accessToken,
      siteId: input.siteId,
      categoryId: listing.categoryId,
      listingTypeId: listing.listingTypeId,
      price: listing.price,
      currencyId: listing.currencyId
    });

    return {
      ...listing,
      fees: {
        ...listing.fees,
        sellingFeeAmount: estimate.feeAmount ?? listing.fees.sellingFeeAmount,
        saleFeeAmount: estimate.feeAmount ?? listing.fees.saleFeeAmount,
        commissionPercent: estimate.feePercentage ?? listing.fees.commissionPercent,
        currencyId: estimate.currencyId ?? listing.fees.currencyId ?? listing.currencyId,
        source: estimate.source ?? listing.fees.source,
        unavailableReason: estimate.unavailableReason
      }
    };
  });
}

async function enrichListingShippingCostsReadOnly(input: {
  organizationId: string;
  connectionId: string;
  accessToken: string;
  sellerId: string;
  listings: MercadoLivreClientListing[];
}) {
  if (!input.listings.length) return input.listings;
  const persistedEstimates = await loadPersistedShippingCostEstimates(input);

  return mapWithConcurrency(input.listings, shippingEstimateConcurrency, async (listing) => {
    if (!listing.shipping) return listing;
    if (typeof listing.shipping.freeShipping !== "boolean") {
      return {
        ...listing,
        shipping: {
          ...listing.shipping,
          costAmount: null,
          costSource: null,
          costUnavailableReason: "Custo ainda nao disponivel.",
          costLastUpdatedAt: null,
          costStale: false
        }
      };
    }

    const query = listingShippingCostQuery({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      sellerId: input.sellerId,
      listing
    });
    if (!query) return listing;
    const estimate = await getListingShippingCostEstimate({
      accessToken: input.accessToken,
      query,
      persistedEstimate: persistedEstimates.get(listing.externalId)
    });

    return {
      ...listing,
      shipping: {
        ...listing.shipping,
        costAmount: estimate.costAmount,
        currencyId: estimate.currencyId ?? listing.shipping.currencyId ?? listing.currencyId,
        costSource: estimate.source,
        costUnavailableReason: estimate.unavailableReason,
        costLastUpdatedAt: estimate.fetchedAt,
        costStale: estimate.stale
      }
    };
  });
}


function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function localAvailableQuantity(
  balances: Array<{
    physicalQuantity: number;
    reservedQuantity: number;
    safetyQuantity: number;
  }>
) {
  if (!balances.length) return null;
  return balances.reduce((total, balance) => total + balance.physicalQuantity - balance.reservedQuantity - balance.safetyQuantity, 0);
}

async function enrichListingsReadOnly(organizationId: string, listings: MercadoLivreClientListing[]) {
  if (!listings.length) return listings;

  const categoryIds = Array.from(new Set(listings.map((listing) => listing.categoryId).filter((value): value is string => Boolean(value))));
  const categoryRows = categoryIds.length
    ? await prisma.marketplaceCategoryCatalog.findMany({
        where: {
          provider: MarketplaceCategoryProvider.MERCADO_LIVRE,
          marketplaceCategoryId: { in: categoryIds }
        },
        select: {
          marketplaceCategoryId: true,
          name: true,
          path: true
        }
      })
    : [];
  const categoryById = new Map(categoryRows.map((category) => [category.marketplaceCategoryId, category]));

  const skus = Array.from(new Set(listings.map((listing) => listing.sku?.trim()).filter((value): value is string => Boolean(value))));
  const gtins = Array.from(new Set(listings.map((listing) => listing.gtin?.trim()).filter((value): value is string => Boolean(value))));
  const productRows =
    skus.length || gtins.length
      ? await prisma.product.findMany({
          where: {
            organizationId,
            OR: [
              ...(skus.length ? [{ sku: { in: skus } }] : []),
              ...(gtins.length ? [{ ean: { in: gtins } }] : [])
            ]
          },
          select: {
            name: true,
            sku: true,
            ean: true,
            prices: {
              where: { status: "ACTIVE" },
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: {
                costPrice: true,
                salePrice: true
              }
            },
            inventory: {
              select: {
                physicalQuantity: true,
                reservedQuantity: true,
                safetyQuantity: true
              }
            }
          }
        })
      : [];

  const productBySku = new Map(productRows.filter((product) => product.sku).map((product) => [product.sku as string, product]));
  const productByGtin = new Map(
    productRows.filter((product) => product.ean).map((product) => {
      const ean = product.ean as string;
      return [normalizeGtin(ean) ?? ean, product] as const;
    })
  );

  return listings.map((listing) => {
    const category = listing.categoryId ? categoryById.get(listing.categoryId) : null;
    const productByListingSku = listing.sku ? productBySku.get(listing.sku) : null;
    const productByListingGtin = listing.gtin ? productByGtin.get(listing.gtin) : null;
    const product = productByListingSku ?? productByListingGtin ?? null;
    const activePrice = product?.prices[0] ?? null;
    const localProduct: MercadoLivreClientListing["localProduct"] = product
      ? {
          found: true,
          name: product.name,
          sku: product.sku,
          ean: product.ean,
          costPrice: decimalToNumber(activePrice?.costPrice),
          salePrice: decimalToNumber(activePrice?.salePrice),
          availableQuantity: localAvailableQuantity(product.inventory),
          matchBy: productByListingSku ? "sku" : "gtin"
        }
      : emptyLocalProduct();
    const feeAmount = listing.fees.sellingFeeAmount ?? listing.fees.saleFeeAmount ?? listing.fees.listingFeeAmount;

    return {
      ...listing,
      categoryName: category?.name ?? null,
      categoryPath: category?.path ?? null,
      localProduct,
      estimatedMargin: buildEstimatedMargin({
        price: listing.price,
        costPrice: localProduct.costPrice,
        feeAmount
      })
    };
  });
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

function normalizeListingSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

function listingMatchesSearchTerm(listing: MercadoLivreClientListing, searchTerm: string) {
  if (!searchTerm) return true;
  const fields = [listing.externalId, listing.itemId, listing.sku, listing.gtin, listing.sellerSku, listing.title];
  return fields.some((field) => field?.toLowerCase().includes(searchTerm));
}

function nativeStatusFilter(value: ListingFilterStatus): ListingStatusFilter | undefined {
  if (value === "under_review") return undefined;
  return listingStatuses.includes(value as ListingStatusFilter) ? (value as ListingStatusFilter) : undefined;
}

function listingMatchesStatusFilter(listing: MercadoLivreClientListing, filter: ListingFilterStatus) {
  if (filter === "all") return true;
  if (filter === "error") return listing.status === "under_review" || listing.status === "inactive";
  return listing.status === filter;
}

function listingMatchesTypeFilter(listing: MercadoLivreClientListing, filter: ListingTypeFilter) {
  if (filter === "all") return true;
  const listingTypeId = listing.listingTypeId?.toLowerCase() ?? "";
  if (filter === "premium") return listingTypeId === "gold_pro";
  if (filter === "classico") return listingTypeId === "gold_special";
  return listingTypeId !== "gold_pro" && listingTypeId !== "gold_special";
}

function listingMatchesStockFilter(listing: MercadoLivreClientListing, filter: StockFilter) {
  if (filter === "all") return true;
  const quantity = listing.availableQuantity ?? 0;
  if (filter === "without_stock") return quantity <= 0;
  return quantity > 0;
}

function listingMatchesFilters(
  listing: MercadoLivreClientListing,
  filters: { query: string; status: ListingFilterStatus; listingType: ListingTypeFilter; stock: StockFilter }
) {
  return (
    listingMatchesSearchTerm(listing, filters.query) &&
    listingMatchesStatusFilter(listing, filters.status) &&
    listingMatchesTypeFilter(listing, filters.listingType) &&
    listingMatchesStockFilter(listing, filters.stock)
  );
}

function uniqueListingsByMercadoLivreId(listings: MercadoLivreClientListing[]) {
  const byId = new Map<string, MercadoLivreClientListing>();
  for (const listing of listings) {
    if (!byId.has(listing.externalId)) {
      byId.set(listing.externalId, listing);
    }
  }
  return Array.from(byId.values());
}

async function fetchListingDetailsReadOnly(input: {
  organizationId: string;
  connectionId: string;
  accessToken: string;
  itemIds: string[];
  syncedAt: Date;
  warnings: string[];
  endpointDiagnostics: Array<Record<string, unknown>>;
}) {
  let accessToken = input.accessToken;
  const listings: MercadoLivreClientListing[] = [];

  for (const ids of chunk(input.itemIds, detailsChunkSize)) {
    const response = await fetchMercadoLivreJson<MercadoLivreMultiGetEntry[]>({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      accessToken,
      path: `/items?ids=${ids.map(encodeURIComponent).join(",")}`
    });
    accessToken = response.accessToken;
    input.endpointDiagnostics.push({
      endpoint: response.endpoint,
      status: response.status,
      requestId: response.requestId,
      correlationId: response.correlationId,
      returnedItems: response.ok ? response.data.length : 0,
      errorCode: response.ok ? null : response.error.error,
      errorMessage: response.ok ? null : response.error.message
    });

    if (!response.ok) {
      input.warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar detalhes dos anuncios.`);
      continue;
    }

    for (const entry of response.data) {
      if (entry.code && entry.code !== 200) {
        input.warnings.push(`Um anuncio Mercado Livre retornou codigo ${entry.code} no detalhe.`);
        continue;
      }
      const normalized = entry.body ? normalizeListing(entry.body, input.syncedAt) : null;
      if (normalized) listings.push(normalized);
    }
  }

  return { accessToken, listings };
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function listingCacheSellerShippingCost(
  listing: MercadoLivreClientListing,
  query: MercadoLivreSellerShippingCostQuery | null,
  previousRawAttributes?: unknown
): Prisma.InputJsonValue {
  const currentShipping = listing.shipping;
  if (!query) {
    return {
      version: MERCADO_LIVRE_SELLER_SHIPPING_COST_CACHE_VERSION,
      marketplaceListingId: listing.externalId,
      amount: null,
      currencyId: currentShipping?.currencyId ?? listing.currencyId,
      source: null,
      lastUpdatedAt: null,
      stale: false,
      unavailableReason: "Custo ainda nao disponivel.",
      context: null
    };
  }
  if (
    typeof currentShipping?.costAmount === "number" &&
    currentShipping.costSource === MERCADO_LIVRE_SELLER_SHIPPING_COST_SOURCE &&
    typeof currentShipping.costLastUpdatedAt === "string"
  ) {
    return buildPersistedSellerShippingCost({
      query,
      costAmount: currentShipping.costAmount,
      currencyId: currentShipping.currencyId,
      lastUpdatedAt: currentShipping.costLastUpdatedAt,
      stale: currentShipping.costStale,
      unavailableReason: currentShipping.costUnavailableReason
    });
  }

  const previous = readCompatiblePersistedSellerShippingCost(jsonRecord(previousRawAttributes)?.sellerShippingCost, query);
  if (previous) {
    return buildPersistedSellerShippingCost({
      query,
      costAmount: previous.costAmount,
      currencyId: previous.currencyId,
      lastUpdatedAt: previous.lastUpdatedAt,
      stale: true,
      unavailableReason: currentShipping?.costUnavailableReason ?? "Custo temporariamente indisponivel."
    });
  }

  return buildPersistedSellerShippingCost({
    query,
    costAmount: null,
    currencyId: currentShipping?.currencyId ?? listing.currencyId,
    lastUpdatedAt: null,
    stale: false,
    unavailableReason: currentShipping?.costUnavailableReason ?? "Custo ainda nao disponivel."
  });
}

function listingCacheRawAttributes(
  listing: MercadoLivreClientListing,
  query: MercadoLivreSellerShippingCostQuery | null,
  previousRawAttributes?: unknown
): Prisma.InputJsonValue {
  const previous = jsonRecord(previousRawAttributes) ?? {};
  return {
    ...previous,
    source: "MERCADO_LIVRE_CLIENT_LISTINGS_READ_ONLY",
    availableQuantity: listing.availableQuantity,
    soldQuantity: listing.soldQuantity,
    listingTypeId: listing.listingTypeId,
    sellerShippingCost: listingCacheSellerShippingCost(listing, query, previousRawAttributes),
    dimensions: listing.dimensionInfo,
    attributes: listing.attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      value: attribute.value
    }))
  };
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

  async filterListings(input: {
    authContext: ClientAuthContext;
    query?: string;
    status?: string;
    listingType?: string;
    stock?: string;
    limit?: number;
    offset?: number;
    maxListings?: number;
  }) {
    const requestedLimit = Math.max(1, Math.min(input.limit ?? defaultLimit, maxLimit));
    const requestedOffset = Math.max(0, input.offset ?? 0);
    const requestedMaxListings = Math.max(requestedLimit, Math.min(input.maxListings ?? globalSearchMaxListings, globalSearchMaxListings));
    const searchTerm = normalizeListingSearchTerm(input.query ?? "");
    const status =
      input.status && listingStatusFilters.includes(input.status as ListingFilterStatus)
        ? (input.status as ListingFilterStatus)
        : "all";
    const listingType =
      input.listingType && listingTypeFilters.includes(input.listingType as ListingTypeFilter)
        ? (input.listingType as ListingTypeFilter)
        : "all";
    const stock =
      input.stock && stockFilters.includes(input.stock as StockFilter)
        ? (input.stock as StockFilter)
        : "all";
    const statusForSearch = nativeStatusFilter(status);
    const canUseNativeMercadoLivrePage =
      !searchTerm && listingType === "all" && stock === "all" && (status === "all" || Boolean(statusForSearch));

    const { connection, accessToken: initialAccessToken } = await mercadoLivreClientOAuthService.getAccessTokenForActiveConnection(input.authContext.organizationId);
    const sellerId = connection.sellerId ?? connection.externalAccountId;
    if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

    let accessToken = initialAccessToken;
    const warnings: string[] = [];
    const endpointDiagnostics: Array<Record<string, unknown>> = [];
    const syncedAt = new Date();
    let sourceTotalAvailable: number | null = null;
    let foundItemIds = 0;
    let matchedItemIds = 0;
    let pageListings: MercadoLivreClientListing[] = [];
    let filteredTotalAvailable: number | null = null;

    if (canUseNativeMercadoLivrePage) {
      const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
        organizationId: input.authContext.organizationId,
        connectionId: connection.id,
        accessToken,
        path: sellerItemsPath({ sellerId, offset: requestedOffset, limit: requestedLimit, status: statusForSearch })
      });
      accessToken = response.accessToken;
      endpointDiagnostics.push({
        endpoint: response.endpoint,
        status: response.status,
        listingStatus: statusForSearch,
        requestId: response.requestId,
        correlationId: response.correlationId,
        returnedIds: response.ok ? response.data.results?.length ?? 0 : 0,
        total: response.ok ? response.data.paging?.total ?? null : null,
        offset: requestedOffset,
        limit: requestedLimit,
        filterMode: "native_status_before_pagination",
        errorCode: response.ok ? null : response.error.error,
        errorMessage: response.ok ? null : response.error.message
      });

      if (!response.ok) {
        warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar anuncios filtrados.`);
      } else {
        sourceTotalAvailable = typeof response.data.paging?.total === "number" ? response.data.paging.total : null;
        filteredTotalAvailable = sourceTotalAvailable;
      }

      const itemIds = response.ok
        ? (response.data.results ?? [])
            .map((id) => normalizeMercadoLivreId(id))
            .filter((id): id is string => Boolean(id))
            .slice(0, requestedLimit)
        : [];
      foundItemIds = itemIds.length;
      matchedItemIds = itemIds.length;

      const detailResult = await fetchListingDetailsReadOnly({
        organizationId: input.authContext.organizationId,
        connectionId: connection.id,
        accessToken,
        itemIds,
        syncedAt,
        warnings,
        endpointDiagnostics
      });
      accessToken = detailResult.accessToken;
      pageListings = uniqueListingsByMercadoLivreId(detailResult.listings).filter((listing) =>
        listingMatchesFilters(listing, { query: searchTerm, status, listingType, stock })
      );
    } else {
      let sourceOffset = 0;
      const matchedListings: MercadoLivreClientListing[] = [];

      while (sourceOffset < requestedMaxListings) {
        const limit = Math.min(maxLimit, requestedMaxListings - sourceOffset);
        const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
          organizationId: input.authContext.organizationId,
          connectionId: connection.id,
          accessToken,
          path: sellerItemsPath({ sellerId, offset: sourceOffset, limit, status: statusForSearch })
        });
        accessToken = response.accessToken;
        const returnedIds = response.ok ? response.data.results?.length ?? 0 : 0;
        endpointDiagnostics.push({
          endpoint: response.endpoint,
          status: response.status,
          listingStatus: statusForSearch ?? "all",
          requestId: response.requestId,
          correlationId: response.correlationId,
          returnedIds,
          total: response.ok ? response.data.paging?.total ?? null : null,
          offset: sourceOffset,
          limit,
          filterMode: "filtered_before_pagination",
          errorCode: response.ok ? null : response.error.error,
          errorMessage: response.ok ? null : response.error.message
        });

        if (!response.ok) {
          warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar anuncios filtrados.`);
          break;
        }

        if (typeof response.data.paging?.total === "number") {
          sourceTotalAvailable = response.data.paging.total;
        }

        const itemIds = (response.data.results ?? [])
          .map((id) => normalizeMercadoLivreId(id))
          .filter((id): id is string => Boolean(id));
        foundItemIds += itemIds.length;

        const detailResult = await fetchListingDetailsReadOnly({
          organizationId: input.authContext.organizationId,
          connectionId: connection.id,
          accessToken,
          itemIds,
          syncedAt,
          warnings,
          endpointDiagnostics
        });
        accessToken = detailResult.accessToken;

        matchedListings.push(
          ...uniqueListingsByMercadoLivreId(detailResult.listings).filter((listing) =>
            listingMatchesFilters(listing, { query: searchTerm, status, listingType, stock })
          )
        );

        if (returnedIds < limit) break;
        sourceOffset += limit;
        if (typeof sourceTotalAvailable === "number" && sourceOffset >= sourceTotalAvailable) break;
      }

      const uniqueMatchedListings = uniqueListingsByMercadoLivreId(matchedListings);
      matchedItemIds = uniqueMatchedListings.length;
      filteredTotalAvailable = matchedItemIds;
      pageListings = uniqueMatchedListings.slice(requestedOffset, requestedOffset + requestedLimit);

      if (typeof sourceTotalAvailable === "number" && sourceTotalAvailable > requestedMaxListings) {
        warnings.push("A busca filtrada analisou o limite de anuncios carregados. Refine os filtros para resultados mais precisos.");
      }
    }

    const feeEnrichedListings = await enrichListingFeesReadOnly({
      accessToken,
      siteId: connection.siteId ?? "MLB",
      listings: pageListings
    });
    const shippingEnrichedListings = await enrichListingShippingCostsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      sellerId,
      listings: feeEnrichedListings
    });
    const enrichedListings = await enrichListingsReadOnly(input.authContext.organizationId, shippingEnrichedListings);

    return {
      connected: true,
      account: safeAccount(connection),
      listings: enrichedListings,
      kpis: buildKpis(enrichedListings),
      foundItemIds,
      detailsFetched: enrichedListings.length,
      totalAvailable: filteredTotalAvailable,
      paging: buildPaging({ limit: requestedLimit, offset: requestedOffset, totalAvailable: filteredTotalAvailable }),
      lastSyncedAt: connection.lastSyncAt?.toISOString() ?? null,
      warnings,
      endpointDiagnostics,
      search: {
        mode: "filtered_before_pagination",
        query: input.query ?? "",
        scannedItemIds: foundItemIds,
        matchedItemIds,
        maxListings: requestedMaxListings,
        sourceTotalAvailable,
        uniqueKey: "externalId",
        filters: {
          status,
          listingType,
          stock
        }
      },
      readOnly: true,
      externalWrite: false
    };
  }

  async searchListings(input: { authContext: ClientAuthContext; query: string; maxListings?: number }) {
    const searchTerm = normalizeListingSearchTerm(input.query);
    if (!searchTerm) return this.getListings(input.authContext);

    const requestedMaxListings = Math.max(1, Math.min(input.maxListings ?? globalSearchMaxListings, globalSearchMaxListings));
    const { connection, accessToken: initialAccessToken } = await mercadoLivreClientOAuthService.getAccessTokenForActiveConnection(input.authContext.organizationId);
    const sellerId = connection.sellerId ?? connection.externalAccountId;
    if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

    let accessToken = initialAccessToken;
    const warnings: string[] = [];
    const endpointDiagnostics: Array<Record<string, unknown>> = [];
    let totalAvailable: number | null = null;
    let offset = 0;
    const itemIdsByMercadoLivreId = new Map<string, string>();

    const directItemId = searchTerm.match(/^ml[a-z]\d+$/i)?.[0]?.toUpperCase() ?? null;
    if (directItemId) {
      itemIdsByMercadoLivreId.set(directItemId, directItemId);
    }

    while (offset < requestedMaxListings) {
      const limit = Math.min(maxLimit, requestedMaxListings - offset);
      const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
        organizationId: input.authContext.organizationId,
        connectionId: connection.id,
        accessToken,
        path: sellerItemsPath({ sellerId, offset, limit })
      });
      accessToken = response.accessToken;
      endpointDiagnostics.push({
        endpoint: response.endpoint,
        status: response.status,
        requestId: response.requestId,
        correlationId: response.correlationId,
        returnedIds: response.ok ? response.data.results?.length ?? 0 : 0,
        total: response.ok ? response.data.paging?.total ?? null : null,
        offset,
        limit,
        searchMode: "global_identifier",
        errorCode: response.ok ? null : response.error.error,
        errorMessage: response.ok ? null : response.error.message
      });

      if (!response.ok) {
        warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar anuncios para pesquisa global.`);
        break;
      }

      if (typeof response.data.paging?.total === "number") {
        totalAvailable = response.data.paging.total;
      }

      const pageIds = (response.data.results ?? [])
        .map((id) => normalizeMercadoLivreId(id))
        .filter((id): id is string => Boolean(id));

      for (const id of pageIds) {
        itemIdsByMercadoLivreId.set(id, id);
      }

      if (pageIds.length < limit) break;
      offset += limit;
      if (typeof totalAvailable === "number" && offset >= totalAvailable) break;
    }

    const syncedAt = new Date();
    const detailResult = await fetchListingDetailsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      itemIds: Array.from(itemIdsByMercadoLivreId.values()),
      syncedAt,
      warnings,
      endpointDiagnostics
    });
    accessToken = detailResult.accessToken;

    const matchedListings = uniqueListingsByMercadoLivreId(detailResult.listings).filter((listing) =>
      listingMatchesSearchTerm(listing, searchTerm)
    );
    const feeEnrichedListings = await enrichListingFeesReadOnly({
      accessToken,
      siteId: connection.siteId ?? "MLB",
      listings: matchedListings
    });
    const shippingEnrichedListings = await enrichListingShippingCostsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      sellerId,
      listings: feeEnrichedListings
    });
    const enrichedListings = await enrichListingsReadOnly(input.authContext.organizationId, shippingEnrichedListings);

    return {
      connected: true,
      account: safeAccount(connection),
      listings: enrichedListings,
      kpis: buildKpis(enrichedListings),
      foundItemIds: itemIdsByMercadoLivreId.size,
      detailsFetched: enrichedListings.length,
      totalAvailable,
      paging: buildPaging({ limit: Math.max(enrichedListings.length, 1), offset: 0, totalAvailable }),
      lastSyncedAt: connection.lastSyncAt?.toISOString() ?? null,
      warnings,
      endpointDiagnostics,
      search: {
        mode: "global_identifier",
        query: input.query,
        scannedItemIds: itemIdsByMercadoLivreId.size,
        maxListings: requestedMaxListings,
        uniqueKey: "externalId"
      },
      readOnly: true,
      externalWrite: false
    };
  }

  async refreshListingCache(input: { authContext: ClientAuthContext; maxListings?: number }) {
    const requestedMaxListings = Math.max(1, Math.min(input.maxListings ?? globalSearchMaxListings, 1000));
    const { connection, accessToken: initialAccessToken } = await mercadoLivreClientOAuthService.getAccessTokenForActiveConnection(input.authContext.organizationId);
    const sellerId = normalizeMercadoLivreId(connection.sellerId ?? connection.externalAccountId);
    if (!sellerId) throw new Error("Conta Mercado Livre conectada sem seller identificado. Reconecte a conta.");

    const cacheConnection = await prisma.mercadoLivreConnection.findFirst({
      where: { organizationId: input.authContext.organizationId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true }
    });
    if (!cacheConnection) {
      throw new Error("Cache Mercado Livre sem conexao local legada para referencia. Verifique a conexao antes de atualizar os vinculos.");
    }

    let accessToken = initialAccessToken;
    const warnings: string[] = [];
    const endpointDiagnostics: Array<Record<string, unknown>> = [];
    const itemIdsByMercadoLivreId = new Map<string, string>();
    let totalAvailable: number | null = null;

    const accountProbe = await fetchMercadoLivreJson<MercadoLivreUserMePayload>({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      path: "/users/me"
    });
    accessToken = accountProbe.accessToken;
    endpointDiagnostics.push({
      endpoint: accountProbe.endpoint,
      status: accountProbe.status,
      requestId: accountProbe.requestId,
      correlationId: accountProbe.correlationId,
      errorCode: accountProbe.ok ? null : accountProbe.error.error,
      errorMessage: accountProbe.ok ? null : accountProbe.error.message
    });
    if (!accountProbe.ok) {
      warnings.push("Nao foi possivel validar /users/me antes de atualizar os vinculos locais.");
    } else {
      const returnedSellerId = normalizeMercadoLivreId(accountProbe.data.id);
      if (returnedSellerId && returnedSellerId !== sellerId) {
        warnings.push("O seller retornado por /users/me nao corresponde ao seller salvo na conexao.");
      }
    }

    for (const listingStatus of cacheRefreshStatusFilters) {
      let offset = 0;

      while (itemIdsByMercadoLivreId.size < requestedMaxListings) {
        const limit = Math.min(maxLimit, requestedMaxListings - itemIdsByMercadoLivreId.size);
        const response = await fetchMercadoLivreJson<MercadoLivreItemSearchPayload>({
          organizationId: input.authContext.organizationId,
          connectionId: connection.id,
          accessToken,
          path: sellerItemsPath({ sellerId, offset, limit, status: listingStatus })
        });
        accessToken = response.accessToken;
        const returnedIds = response.ok ? response.data.results?.length ?? 0 : 0;
        endpointDiagnostics.push({
          endpoint: response.endpoint,
          status: response.status,
          listingStatus: listingStatus ?? "all",
          requestId: response.requestId,
          correlationId: response.correlationId,
          returnedIds,
          total: response.ok ? response.data.paging?.total ?? null : null,
          offset,
          limit,
          errorCode: response.ok ? null : response.error.error,
          errorMessage: response.ok ? null : response.error.message
        });

        if (!response.ok) {
          warnings.push(`Mercado Livre retornou HTTP ${response.status} ao buscar anuncios para o cache local.`);
          break;
        }

        if (typeof response.data.paging?.total === "number") {
          totalAvailable = Math.max(totalAvailable ?? 0, response.data.paging.total);
        }

        for (const id of response.data.results ?? []) {
          const normalizedId = normalizeMercadoLivreId(id);
          if (normalizedId && !itemIdsByMercadoLivreId.has(normalizedId)) {
            itemIdsByMercadoLivreId.set(normalizedId, normalizedId);
          }
        }

        if (returnedIds < limit) break;
        offset += limit;
      }

      if (itemIdsByMercadoLivreId.size >= requestedMaxListings) break;
    }

    const syncedAt = new Date();
    const detailResult = await fetchListingDetailsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      itemIds: Array.from(itemIdsByMercadoLivreId.values()),
      syncedAt,
      warnings,
      endpointDiagnostics
    });
    accessToken = detailResult.accessToken;
    void accessToken;

    const listings = uniqueListingsByMercadoLivreId(detailResult.listings);
    const shippingEnrichedListings = await enrichListingShippingCostsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      sellerId,
      listings
    });
    const listingsWithLocalCategory = await enrichListingsReadOnly(input.authContext.organizationId, shippingEnrichedListings);
    const existingCacheRows = await prisma.mercadoLivreListingCache.findMany({
      where: {
        mercadoLivreConnectionId: cacheConnection.id,
        externalItemId: { in: listingsWithLocalCategory.map((listing) => listing.externalId) }
      },
      select: {
        externalItemId: true,
        rawAttributesJson: true
      }
    });
    const existingRawAttributesByItemId = new Map(existingCacheRows.map((row) => [row.externalItemId, row.rawAttributesJson]));
    let upserted = 0;

    for (const listing of listingsWithLocalCategory) {
      const query = listingShippingCostQuery({
        organizationId: input.authContext.organizationId,
        connectionId: connection.id,
        sellerId,
        listing
      });
      const rawAttributesJson = listingCacheRawAttributes(listing, query, existingRawAttributesByItemId.get(listing.externalId));
      await prisma.mercadoLivreListingCache.upsert({
        where: {
          mercadoLivreConnectionId_externalItemId: {
            mercadoLivreConnectionId: cacheConnection.id,
            externalItemId: listing.externalId
          }
        },
        create: {
          organizationId: input.authContext.organizationId,
          mercadoLivreConnectionId: cacheConnection.id,
          externalItemId: listing.externalId,
          title: listing.title,
          sku: listing.sku,
          gtin: listing.gtin,
          brand: listing.attributes.find((attribute) => attribute.id?.toUpperCase() === "BRAND")?.value ?? null,
          partNumber:
            listing.attributes.find((attribute) => ["PART_NUMBER", "MANUFACTURER_PART_NUMBER", "MPN", "OEM"].includes(attribute.id?.toUpperCase() ?? ""))?.value ??
            null,
          categoryId: listing.categoryId,
          categoryName: listing.categoryName,
          price: listing.price,
          currencyId: listing.currencyId,
          status: listing.status,
          permalink: listing.permalink,
          thumbnail: listing.thumbnail,
          rawAttributesJson,
          lastSyncedAt: syncedAt
        },
        update: {
          title: listing.title,
          sku: listing.sku,
          gtin: listing.gtin,
          brand: listing.attributes.find((attribute) => attribute.id?.toUpperCase() === "BRAND")?.value ?? null,
          partNumber:
            listing.attributes.find((attribute) => ["PART_NUMBER", "MANUFACTURER_PART_NUMBER", "MPN", "OEM"].includes(attribute.id?.toUpperCase() ?? ""))?.value ??
            null,
          categoryId: listing.categoryId,
          categoryName: listing.categoryName,
          price: listing.price,
          currencyId: listing.currencyId,
          status: listing.status,
          permalink: listing.permalink,
          thumbnail: listing.thumbnail,
          rawAttributesJson,
          lastSyncedAt: syncedAt
        }
      });
      upserted += 1;
    }

    const cacheTotal = await prisma.mercadoLivreListingCache.count({
      where: { organizationId: input.authContext.organizationId }
    });
    const statusSummary = listingsWithLocalCategory.reduce<Record<string, number>>((summary, listing) => {
      const key = listing.status ?? "unknown";
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {});

    return {
      source: "mercado_livre_client_listings_service",
      connectionModel: "MarketplaceConnection",
      cacheModel: "MercadoLivreListingCache",
      foundItemIds: itemIdsByMercadoLivreId.size,
      totalAvailable,
      detailsFetched: listings.length,
      upserted,
      cacheTotal,
      lastSyncedAt: syncedAt.toISOString(),
      statusSummary,
      warnings,
      endpointDiagnostics,
      skuSourceOrder: ["item.seller_custom_field", "variation.seller_custom_field", "attributes.SELLER_SKU", "attributes.SKU"],
      skuLinkRule: "sku_exato_do_anuncio",
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
    const detailResult = await fetchListingDetailsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      itemIds,
      syncedAt,
      warnings,
      endpointDiagnostics
    });
    accessToken = detailResult.accessToken;
    const listings = uniqueListingsByMercadoLivreId(detailResult.listings);

    const feeEnrichedListings = await enrichListingFeesReadOnly({
      accessToken,
      siteId: connection.siteId ?? "MLB",
      listings
    });
    const shippingEnrichedListings = await enrichListingShippingCostsReadOnly({
      organizationId: input.authContext.organizationId,
      connectionId: connection.id,
      accessToken,
      sellerId,
      listings: feeEnrichedListings
    });
    const enrichedListings = await enrichListingsReadOnly(input.authContext.organizationId, shippingEnrichedListings);

    const updatedConnection = await prisma.marketplaceConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: syncedAt,
        lastError: warnings[0] ?? null
      }
    });

    memoryCache.set(cacheKey(input.authContext.organizationId, connection.id), {
      connectionId: connection.id,
      listings: enrichedListings,
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
        detailsFetched: enrichedListings.length,
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
      listings: enrichedListings,
      kpis: buildKpis(enrichedListings),
      foundItemIds: itemIds.length,
      detailsFetched: enrichedListings.length,
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
