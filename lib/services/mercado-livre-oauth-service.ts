import { createHash, randomBytes } from "crypto";
import type { MercadoLivreConnection, Prisma } from "@prisma/client";
import { ConnectionRole, OAuthProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { sanitizeLogPayload } from "@/lib/utils";
import { buildProductReferenceSearchQueries } from "@/lib/intelligent-product-compatibility";

const tokenUrl = "https://api.mercadolibre.com/oauth/token";
const apiBaseUrl = "https://api.mercadolibre.com";
const stateTtlMs = 10 * 60 * 1000;
const mercadoLivreSearchBlockedWarning = "O Catalogo Mercado Livre recusou a consulta read-only no momento. A busca local continua disponivel.";
const mercadoLivreDetailTimeoutMs = 8000;
const mercadoLivreTitleSearchMaxQueries = 3;
const mercadoLivreTitleSearchPauseMs = 150;

type MercadoLivreTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  user_id?: number | string;
};

type MercadoLivreUserResponse = {
  id?: number | string;
  nickname?: string;
};

type MercadoLivreSearchItem = {
  id?: string;
  item_id?: string;
  title?: string;
  price?: number;
  currency_id?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  category_id?: string;
  seller_id?: number | string;
  listing_type_id?: string | null;
  condition?: string | null;
  sold_quantity?: number | null;
  status?: string | null;
  address?: {
    city_name?: string | null;
    state_name?: string | null;
  } | null;
  seller_address?: {
    city?: { name?: string | null } | null;
    state?: { name?: string | null } | null;
  } | null;
  attributes?: Array<{ id?: string; name?: string; value_name?: string; values?: Array<{ name?: string }> }>;
};

type MercadoLivreProductSearchItem = {
  id?: string;
  catalog_product_id?: string | null;
  name?: string;
  status?: string;
  domain_id?: string;
  category_id?: string;
  pictures?: Array<{ url?: string; secure_url?: string }>;
  attributes?: Array<{ id?: string; name?: string; value_name?: string; values?: Array<{ name?: string }> }>;
  buy_box_winner?: {
    item_id?: string;
    price?: number;
    currency_id?: string;
    category_id?: string;
    permalink?: string;
    thumbnail?: string;
    title?: string;
    seller_id?: number | string;
    listing_type_id?: string | null;
    condition?: string | null;
    sold_quantity?: number | null;
  } | null;
};

type MercadoLivreProductSearchResponse = {
  results?: MercadoLivreProductSearchItem[];
  paging?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
};

type MercadoLivreCatalogOfferItem = MercadoLivreSearchItem & {
  item_id?: string;
  original_price?: number | null;
};

type MercadoLivreCatalogOffersResponse = {
  results?: MercadoLivreCatalogOfferItem[];
  paging?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
};

type NormalizedMercadoLivreSearchItem = {
  externalItemId: string | null;
  catalogProductId: string | null;
  title: string | null;
  description: string | null;
  price: number | null;
  currencyId: string | null;
  permalink: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  categoryId: string | null;
  categoryName: string | null;
  categoryPath: string | null;
  gtin: string | null;
  brand: string | null;
  partNumber: string | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerReputation: string | null;
  sellerReputationLevel: string | null;
  sellerTransactionsTotal: number | null;
  sellerTransactionsCompleted: number | null;
  soldQuantity: number | null;
  condition: string | null;
  location: string | null;
  stateName: string | null;
  cityName: string | null;
  listingTypeId: string | null;
  listingTypeLabel: string | null;
  status: string | null;
  attributes: Array<{ id: string | null; name: string | null; value: string | null }>;
  source: "MERCADO_LIVRE_PUBLIC_SEARCH" | "MERCADO_LIVRE_PRODUCT_SEARCH";
  dataAvailability?: "complete" | "catalog_offer" | "catalog_without_public_offer" | "partial";
  dataAvailabilityMessage?: string | null;
};

type MercadoLivreItemDetailResponse = MercadoLivreSearchItem & {
  pictures?: Array<{ url?: string | null; secure_url?: string | null }>;
  catalog_product_id?: string | null;
};

type MercadoLivreProductDetailResponse = MercadoLivreProductSearchItem & {
  permalink?: string | null;
};

type MercadoLivreItemDescriptionResponse = {
  plain_text?: string | null;
  text?: string | null;
};

type MercadoLivreSellerResponse = {
  id?: number | string;
  nickname?: string | null;
  seller_reputation?: {
    level_id?: string | null;
    power_seller_status?: string | null;
    transactions?: {
      total?: number | null;
      completed?: number | null;
      ratings?: Record<string, unknown> | null;
    } | null;
  } | null;
};

type MercadoLivreCategoryResponse = {
  id?: string | null;
  name?: string | null;
  path_from_root?: Array<{ id?: string | null; name?: string | null }>;
};

type MercadoLivreSearchPaging = {
  total: number | null;
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

type MercadoLivreCredentials = {
  source: "database" | "env";
  connectionId: string | null;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  siteId: string;
};

type SaveConfigInput = {
  organizationId: string;
  userId: string;
  accountAlias: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  siteId: string;
  taxRate?: string | null;
  orderImportStartDate?: string | null;
};

export type MercadoLivreSearchMode = "auto" | "gtin" | "title";

export type MercadoLivreSearchAuthContext = {
  organizationId: string;
  user: {
    id: string;
    email: string;
  };
  role?: string;
};

const localProductSearchSelect = {
  id: true,
  sku: true,
  ean: true,
  name: true,
  brand: true,
  syncStatus: true,
  source: true,
  images: { take: 1, orderBy: { position: "asc" as const }, select: { url: true } },
  mappings: {
    take: 1,
    orderBy: { updatedAt: "desc" as const },
    select: {
      connectionId: true,
      externalProductId: true,
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
  }
} satisfies Prisma.ProductSelect;

type LocalProductSearchRecord = Prisma.ProductGetPayload<{ select: typeof localProductSearchSelect }>;

function mercadoLivreSearchItemKey(item: NormalizedMercadoLivreSearchItem) {
  return item.externalItemId ?? item.catalogProductId ?? `${item.title ?? ""}|${item.gtin ?? ""}|${item.imageUrl ?? ""}`;
}

function mergeUniqueMercadoLivreSearchItems(
  current: NormalizedMercadoLivreSearchItem[],
  incoming: NormalizedMercadoLivreSearchItem[]
) {
  const seen = new Set<string>();
  const merged: NormalizedMercadoLivreSearchItem[] = [];
  for (const item of [...current, ...incoming]) {
    const key = mercadoLivreSearchItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function pauseMercadoLivreTitleSearch() {
  return new Promise((resolve) => setTimeout(resolve, mercadoLivreTitleSearchPauseMs));
}

function hashState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readEnvAlias(...names: string[]) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }
  return null;
}

function parsePositiveInteger(value: string | number | null | undefined, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveMercadoLivrePagingInput(pageValue?: string | number | null, pageSizeValue?: string | number | null) {
  const page = Math.max(1, parsePositiveInteger(pageValue, 1));
  const pageSize = Math.min(20, Math.max(1, parsePositiveInteger(pageSizeValue, 10)));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function buildMercadoLivrePaging(input: {
  page: number;
  pageSize: number;
  offset: number;
  resultCount: number;
  apiPaging?: { total?: number; limit?: number; offset?: number } | null;
}): MercadoLivreSearchPaging {
  const limit = input.apiPaging?.limit && input.apiPaging.limit > 0 ? input.apiPaging.limit : input.pageSize;
  const offset = typeof input.apiPaging?.offset === "number" && input.apiPaging.offset >= 0 ? input.apiPaging.offset : input.offset;
  const total = typeof input.apiPaging?.total === "number" && input.apiPaging.total >= 0 ? input.apiPaging.total : null;
  const hasPreviousPage = offset > 0;
  const hasNextPage = total === null ? input.resultCount >= limit : offset + input.resultCount < total;
  const page = Math.floor(offset / Math.max(1, limit)) + 1;

  return {
    total,
    limit,
    offset,
    page,
    pageSize: limit,
    hasNextPage,
    hasPreviousPage
  };
}

function hasEnvCredentials() {
  return Boolean(
    readEnvAlias("MERCADO_LIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_ID") &&
      readEnvAlias("MERCADO_LIVRE_CLIENT_SECRET", "MERCADOLIVRE_CLIENT_SECRET") &&
      readEnvAlias("MERCADO_LIVRE_REDIRECT_URI", "MERCADOLIVRE_REDIRECT_URI")
  );
}

function getEnvCredentials(): MercadoLivreCredentials | null {
  const clientId = readEnvAlias("MERCADO_LIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_ID");
  const clientSecret = readEnvAlias("MERCADO_LIVRE_CLIENT_SECRET", "MERCADOLIVRE_CLIENT_SECRET");
  const redirectUri = readEnvAlias("MERCADO_LIVRE_REDIRECT_URI", "MERCADOLIVRE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) return null;

  return {
    source: "env",
    connectionId: null,
    clientId,
    clientSecret,
    redirectUri,
    siteId: readEnvAlias("MERCADO_LIVRE_SITE_ID", "MERCADOLIVRE_SITE_ID") ?? "MLB"
  };
}

function missingEnvCredentialNames() {
  const missing: string[] = [];
  if (!readEnvAlias("MERCADO_LIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_ID")) missing.push("MERCADO_LIVRE_CLIENT_ID");
  if (!readEnvAlias("MERCADO_LIVRE_CLIENT_SECRET", "MERCADOLIVRE_CLIENT_SECRET")) missing.push("MERCADO_LIVRE_CLIENT_SECRET");
  if (!readEnvAlias("MERCADO_LIVRE_REDIRECT_URI", "MERCADOLIVRE_REDIRECT_URI")) missing.push("MERCADO_LIVRE_REDIRECT_URI");
  return missing;
}

function getAuthorizationBaseUrl(siteId: string) {
  if (siteId === "MLB") return "https://auth.mercadolivre.com.br/authorization";
  return "https://auth.mercadolibre.com/authorization";
}

function maskClientId(clientId: string | null | undefined) {
  if (!clientId) return null;
  if (clientId.length <= 8) return `${clientId.slice(0, 2)}••••${clientId.slice(-2)}`;
  return `${clientId.slice(0, 4)}••••${clientId.slice(-4)}`;
}

export function normalizeMercadoLivreSearchMode(value: string | null | undefined): MercadoLivreSearchMode {
  return value === "gtin" || value === "title" || value === "auto" ? value : "auto";
}

function productContextWhere(authContext: MercadoLivreSearchAuthContext, selectedConnectionId: string | null): Prisma.ProductWhereInput {
  return {
    organizationId: authContext.organizationId,
    ...(selectedConnectionId
      ? {
          mappings: {
            some: {
              organizationId: authContext.organizationId,
              connectionId: selectedConnectionId
            }
          }
        }
      : {})
  };
}

export async function findLocalProductForMercadoLivreSearch(authContext: MercadoLivreSearchAuthContext, rawQuery: string) {
  const accountContext = await getUserAccountContext(authContext);
  const selectedConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;
  const baseWhere = productContextWhere(authContext, selectedConnectionId);
  const normalizedGtin = normalizeGtin(rawQuery);

  const bySku = await prisma.product.findFirst({
    where: { ...baseWhere, sku: { equals: rawQuery, mode: "insensitive" } },
    select: localProductSearchSelect
  });
  if (bySku) return { product: bySku, matchType: "SKU" as const, accountContext };

  if (normalizedGtin && isValidGtin(normalizedGtin)) {
    const byGtin = await prisma.product.findFirst({
      where: { ...baseWhere, ean: normalizedGtin },
      select: localProductSearchSelect
    });
    if (byGtin) return { product: byGtin, matchType: "GTIN" as const, accountContext };
  }

  if (rawQuery.length >= 3) {
    const byTitle = await prisma.product.findFirst({
      where: { ...baseWhere, name: { contains: rawQuery, mode: "insensitive" } },
      select: localProductSearchSelect,
      orderBy: { updatedAt: "desc" }
    });
    if (byTitle) return { product: byTitle, matchType: "TITLE" as const, accountContext };
  }

  return { product: null, matchType: "NONE" as const, accountContext };
}

function blingConnectionLabel(connection: LocalProductSearchRecord["mappings"][number]["connection"] | undefined) {
  if (!connection) return null;
  return connection.name || connection.externalCompanyName || connection.externalCompanyDocument || connection.externalAccountId || "Conta Bling";
}

export function toSafeMercadoLivreSearchProduct(product: LocalProductSearchRecord | null, matchType: "SKU" | "GTIN" | "TITLE" | "NONE") {
  if (!product) return null;
  const mapping = product.mappings[0] ?? null;
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    gtin: product.ean,
    brand: product.brand,
    imageUrl: product.images[0]?.url ?? null,
    syncStatus: product.syncStatus,
    source: product.source,
    matchType,
    blingAccount: mapping
      ? {
          id: mapping.connectionId,
          name: blingConnectionLabel(mapping.connection),
          externalProductId: mapping.externalProductId,
          status: mapping.connection.status,
          isDefault: mapping.connection.isDefault
        }
      : null
  };
}

export function resolveMercadoLivreSearch(input: { rawQuery: string; requestedMode: MercadoLivreSearchMode; localProduct: LocalProductSearchRecord | null }) {
  const warnings: string[] = [];
  const queryGtin = normalizeGtin(input.rawQuery);
  const productGtin = input.localProduct?.ean ? normalizeGtin(input.localProduct.ean) : null;
  const hasQueryGtin = Boolean(queryGtin && isValidGtin(queryGtin));
  const hasProductGtin = Boolean(productGtin && isValidGtin(productGtin));

  if (input.requestedMode === "gtin") {
    const value = hasProductGtin ? productGtin : hasQueryGtin ? queryGtin : null;
    if (!value) warnings.push("Este produto nao possui GTIN/EAN disponivel para busca.");
    return { searchMode: "gtin" as const, searchType: "GTIN" as const, searchValue: value, warnings };
  }

  if (input.requestedMode === "title") {
    return { searchMode: "title" as const, searchType: "TITLE" as const, searchValue: input.localProduct?.name?.trim() || input.rawQuery, warnings };
  }

  if (hasQueryGtin) {
    return { searchMode: "auto" as const, searchType: "GTIN" as const, searchValue: queryGtin, warnings };
  }

  if (hasProductGtin) {
    return { searchMode: "auto" as const, searchType: "GTIN" as const, searchValue: productGtin, warnings };
  }

  return { searchMode: "auto" as const, searchType: "TITLE" as const, searchValue: input.localProduct?.name?.trim() || input.rawQuery, warnings };
}

function normalizeTaxRate(value?: string | null) {
  if (!value) return null;
  const normalized = Number(value.replace(",", "."));
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
    throw new Error("Alíquota de imposto inválida.");
  }
  return normalized.toFixed(2);
}

function normalizeOrderImportStartDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data inicial de importação inválida.");
  }
  return date;
}

function statusLabel(connection: MercadoLivreConnection | null, configured: boolean) {
  if (!connection && !configured) return "Configuração ausente";
  if (!connection && configured) return "Pronto para conectar";
  if (!connection) return "Não conectado";
  if (connection.status === "ACTIVE") return "Integrado";
  if (connection.status === "EXPIRED") return "Token expirado";
  if (connection.status === "ERROR") return "Erro de conexão";
  if (connection.configStatus === "READY" || configured) return "Pronto para conectar";
  return "Configuração ausente";
}

async function audit(organizationId: string, userId: string | null, action: string, metadata: Record<string, unknown>) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId,
      action,
      entity: "MercadoLivreConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}

async function fetchCurrentMercadoLivreUser(accessToken: string) {
  const response = await fetch(`${apiBaseUrl}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as MercadoLivreUserResponse;
  return {
    id: payload.id ? String(payload.id) : null,
    nickname: payload.nickname?.trim() || null
  };
}

function attributeValue(attribute: { value_name?: string; values?: Array<{ name?: string }> }) {
  return attribute.value_name ?? attribute.values?.find((value) => value.name)?.name ?? null;
}

function firstText(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function pickAttribute(attributes: MercadoLivreSearchItem["attributes"], ids: string[]) {
  const found = attributes?.find((attribute) => attribute.id && ids.includes(attribute.id));
  return found ? attributeValue(found) : null;
}

function normalizeAttributes(attributes: MercadoLivreSearchItem["attributes"]) {
  return (attributes ?? [])
    .map((attribute) => ({
      id: attribute.id ?? null,
      name: attribute.name ?? attribute.id ?? null,
      value: attributeValue(attribute)
    }))
    .filter((attribute) => attribute.id || attribute.name || attribute.value)
    .slice(0, 20);
}

function mergeAttributes(...sources: Array<NormalizedMercadoLivreSearchItem["attributes"]>) {
  const seen = new Set<string>();
  const merged: NormalizedMercadoLivreSearchItem["attributes"] = [];
  for (const attributes of sources) {
    for (const attribute of attributes) {
      const key = `${attribute.id ?? ""}:${attribute.name ?? ""}:${attribute.value ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(attribute);
    }
  }
  return merged.slice(0, 30);
}

function mercadoLivreItemId(item: Pick<MercadoLivreSearchItem, "id" | "item_id"> | null | undefined) {
  return firstText(item?.item_id, item?.id);
}

function offerCompletenessScore(offer: MercadoLivreCatalogOfferItem | null | undefined) {
  if (!offer) return -1;
  const location = sellerAddressParts(offer);
  let score = 0;

  if (mercadoLivreItemId(offer)) score += 8;
  if (typeof offer.price === "number") score += 8;
  if (firstText(offer.seller_id)) score += 6;
  if (firstText(offer.category_id)) score += 5;
  if (firstText(offer.permalink)) score += 4;
  if (firstText(offer.thumbnail, offer.secure_thumbnail)) score += 3;
  if (firstText(offer.listing_type_id)) score += 3;
  if (firstText(offer.condition)) score += 2;
  if (firstNumber(offer.sold_quantity) !== null) score += 2;
  if (location.location) score += 2;
  if (normalizeAttributes(offer.attributes).length) score += 2;

  return score;
}

function pickBestCatalogOffer(response: MercadoLivreCatalogOffersResponse | null | undefined) {
  const offers = response?.results ?? [];
  return offers
    .map((offer, index) => ({ offer, index, score: offerCompletenessScore(offer) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })[0]?.offer ?? null;
}

function mergeMercadoLivreItemDetail(
  offer: MercadoLivreCatalogOfferItem | null,
  itemDetail: MercadoLivreItemDetailResponse | null
): MercadoLivreItemDetailResponse | null {
  if (!offer && !itemDetail) return null;
  if (!offer) return itemDetail;
  if (!itemDetail) return offer;

  return {
    ...offer,
    ...itemDetail,
    id: firstText(itemDetail.id, itemDetail.item_id, offer.id, offer.item_id) ?? undefined,
    item_id: firstText(itemDetail.item_id, itemDetail.id, offer.item_id, offer.id) ?? undefined,
    title: firstText(itemDetail.title, offer.title) ?? undefined,
    price: firstNumber(itemDetail.price, offer.price) ?? undefined,
    currency_id: firstText(itemDetail.currency_id, offer.currency_id) ?? undefined,
    permalink: firstText(itemDetail.permalink, offer.permalink) ?? undefined,
    thumbnail: firstText(itemDetail.thumbnail, offer.thumbnail) ?? undefined,
    secure_thumbnail: firstText(itemDetail.secure_thumbnail, offer.secure_thumbnail) ?? undefined,
    category_id: firstText(itemDetail.category_id, offer.category_id) ?? undefined,
    seller_id: firstText(itemDetail.seller_id, offer.seller_id) ?? undefined,
    listing_type_id: firstText(itemDetail.listing_type_id, offer.listing_type_id) ?? undefined,
    condition: firstText(itemDetail.condition, offer.condition) ?? undefined,
    sold_quantity: firstNumber(itemDetail.sold_quantity, offer.sold_quantity) ?? undefined,
    status: firstText(itemDetail.status, offer.status) ?? undefined,
    address: itemDetail.address ?? offer.address,
    seller_address: itemDetail.seller_address ?? offer.seller_address,
    attributes: itemDetail.attributes?.length ? itemDetail.attributes : offer.attributes,
    pictures: itemDetail.pictures?.length ? itemDetail.pictures : []
  };
}

function listingTypeLabel(listingTypeId: string | null | undefined) {
  if (!listingTypeId) return null;
  const normalized = listingTypeId.toLowerCase();
  if (["gold_special", "gold", "silver", "bronze"].includes(normalized)) return "Clássico";
  if (["gold_pro", "gold_premium"].includes(normalized)) return "Premium";
  if (normalized === "free") return "Gratuito";
  return "Tipo não informado";
}

function mercadoLivrePermalinkFromItemId(itemId: string | null | undefined) {
  const normalized = itemId?.trim().toUpperCase();
  if (!normalized || !/^MLB\d+$/.test(normalized)) return null;
  return `https://produto.mercadolivre.com.br/MLB-${normalized.replace(/^MLB/, "")}`;
}

function sellerAddressParts(item: Pick<MercadoLivreSearchItem, "address" | "seller_address">) {
  const cityName = firstText(item.address?.city_name, item.seller_address?.city?.name);
  const stateName = firstText(item.address?.state_name, item.seller_address?.state?.name);
  const location = [cityName, stateName].filter(Boolean).join(" - ") || null;
  return { cityName, stateName, location };
}

function categoryPath(category: MercadoLivreCategoryResponse | null | undefined) {
  const path = category?.path_from_root?.map((item) => item.name?.trim()).filter((name): name is string => Boolean(name));
  return path?.length ? path.join(" > ") : firstText(category?.name);
}

function isMercadoLivreCategoryId(value: string | null | undefined): value is string {
  return Boolean(value && /^ML[A-Z]\d+$/i.test(value));
}

function hasUsefulMercadoLivreCategory(item: NormalizedMercadoLivreSearchItem) {
  return Boolean(item.categoryPath?.trim() || item.categoryName?.trim() || isMercadoLivreCategoryId(item.categoryId));
}

function isUsefulMercadoLivreSearchItem(item: NormalizedMercadoLivreSearchItem) {
  return Boolean(
    item.title?.trim() &&
      (item.imageUrl || item.imageUrls.length) &&
      typeof item.price === "number" &&
      (item.externalItemId || item.permalink) &&
      hasUsefulMercadoLivreCategory(item) &&
      (item.sellerName || item.sellerId)
  );
}

function classifyMercadoLivreDataAvailability(
  item: NormalizedMercadoLivreSearchItem,
  endpointDiagnostics: MercadoLivreEndpointDiagnostic[] = []
) {
  if (isUsefulMercadoLivreSearchItem(item)) {
    return { status: "complete" as const, message: null };
  }

  const catalogOfferDiagnostic = endpointDiagnostics.find(
    (diagnostic) =>
      diagnostic.endpoint.includes("/products/") &&
      diagnostic.endpoint.includes("/items?") &&
      diagnostic.endpoint.includes(item.catalogProductId ?? "__missing_catalog__")
  );
  const catalogWithoutOffer =
    item.source === "MERCADO_LIVRE_PRODUCT_SEARCH" &&
    Boolean(item.catalogProductId) &&
    !item.externalItemId &&
    typeof item.price !== "number" &&
    !item.sellerId &&
    !item.sellerName &&
    catalogOfferDiagnostic?.httpStatus === 404 &&
    catalogOfferDiagnostic.error === "not_found";

  if (catalogWithoutOffer) {
    return {
      status: "catalog_without_public_offer" as const,
      message:
        "Produto de catalogo localizado, mas a API oficial nao retornou oferta publica vencedora para completar preco e vendedor."
    };
  }

  if (item.source === "MERCADO_LIVRE_PRODUCT_SEARCH" && item.catalogProductId && item.externalItemId) {
    return {
      status: "catalog_offer" as const,
      message: null
    };
  }

  return {
    status: "partial" as const,
    message: "Alguns dados de oferta nao foram retornados pela API oficial do Mercado Livre para este resultado."
  };
}

function withMercadoLivreDataAvailability(
  item: NormalizedMercadoLivreSearchItem,
  endpointDiagnostics: MercadoLivreEndpointDiagnostic[] = []
): NormalizedMercadoLivreSearchItem {
  const availability = classifyMercadoLivreDataAvailability(item, endpointDiagnostics);
  return {
    ...item,
    dataAvailability: availability.status,
    dataAvailabilityMessage: availability.message
  };
}

function prioritizeMercadoLivreSearchItems(items: NormalizedMercadoLivreSearchItem[]) {
  const useful = items.filter(isUsefulMercadoLivreSearchItem);
  const incomplete = items.filter((item) => !isUsefulMercadoLivreSearchItem(item));

  return {
    items: [...useful, ...incomplete],
    analyzedResultsCount: items.length,
    usefulResultsCount: useful.length,
    displayedResultsCount: items.length,
    hiddenIncompleteResultsCount: 0
  };
}

function normalizeProductSearchItem(item: MercadoLivreProductSearchItem): NormalizedMercadoLivreSearchItem {
  const pictureUrls = (item.pictures ?? [])
    .map((picture) => picture.secure_url ?? picture.url ?? null)
    .filter((url): url is string => Boolean(url));
  const imageUrl = pictureUrls[0] ?? item.buy_box_winner?.thumbnail ?? null;
  const sellerId = firstText(item.buy_box_winner?.seller_id);
  const soldQuantity = firstNumber(item.buy_box_winner?.sold_quantity);
  const listingTypeId = firstText(item.buy_box_winner?.listing_type_id);
  return {
    externalItemId: item.buy_box_winner?.item_id ?? null,
    catalogProductId: item.catalog_product_id ?? item.id ?? null,
    title: item.name ?? item.buy_box_winner?.title ?? null,
    description: null,
    price: typeof item.buy_box_winner?.price === "number" ? item.buy_box_winner.price : null,
    currencyId: item.buy_box_winner?.currency_id ?? null,
    permalink: item.buy_box_winner?.permalink ?? null,
    imageUrl,
    imageUrls: Array.from(new Set(imageUrl ? [imageUrl, ...pictureUrls] : pictureUrls)).slice(0, 12),
    categoryId: item.buy_box_winner?.category_id ?? item.category_id ?? null,
    categoryName: item.domain_id ?? null,
    categoryPath: null,
    gtin: pickAttribute(item.attributes, ["GTIN", "EAN", "UPC"]),
    brand: pickAttribute(item.attributes, ["BRAND", "MARCA"]),
    partNumber: pickAttribute(item.attributes, ["PART_NUMBER", "MPN", "OEM"]),
    sellerId,
    sellerName: null,
    sellerReputation: null,
    sellerReputationLevel: null,
    sellerTransactionsTotal: null,
    sellerTransactionsCompleted: null,
    soldQuantity,
    condition: item.buy_box_winner?.condition ?? null,
    location: null,
    stateName: null,
    cityName: null,
    listingTypeId,
    listingTypeLabel: listingTypeLabel(listingTypeId),
    status: item.status ?? null,
    attributes: normalizeAttributes(item.attributes),
    source: "MERCADO_LIVRE_PRODUCT_SEARCH"
  };
}

function mergeMercadoLivreSearchItem(
  base: NormalizedMercadoLivreSearchItem,
  detail: MercadoLivreItemDetailResponse | null,
  seller: MercadoLivreSellerResponse | null,
  category: MercadoLivreCategoryResponse | null,
  productDetail: MercadoLivreProductDetailResponse | null = null,
  description: MercadoLivreItemDescriptionResponse | null = null
): NormalizedMercadoLivreSearchItem {
  const detailImageUrls = (detail?.pictures ?? [])
    .map((picture) => picture.secure_url ?? picture.url ?? null)
    .filter((url): url is string => Boolean(url));
  const productImageUrls = (productDetail?.pictures ?? [])
    .map((picture) => picture.secure_url ?? picture.url ?? null)
    .filter((url): url is string => Boolean(url));
  const detailImage = detail?.secure_thumbnail ?? detail?.thumbnail ?? detailImageUrls[0] ?? null;
  const detailLocation = detail ? sellerAddressParts(detail) : { cityName: null, stateName: null, location: null };
  const detailAttributes = normalizeAttributes(detail?.attributes);
  const productAttributes = normalizeAttributes(productDetail?.attributes);
  const sellerReputation = seller?.seller_reputation ?? null;
  const sellerTransactions = sellerReputation?.transactions ?? null;
  const listingTypeId = firstText(detail?.listing_type_id, base.listingTypeId);
  const sellerId = firstText(detail?.seller_id, base.sellerId, seller?.id);
  const externalItemId = firstText(detail?.item_id, detail?.id, base.externalItemId);
  const categoryPathValue = categoryPath(category);

  return {
    ...base,
    externalItemId,
    catalogProductId: firstText(detail?.catalog_product_id, productDetail?.catalog_product_id, productDetail?.id, base.catalogProductId),
    title: firstText(detail?.title, productDetail?.name, base.title),
    description: firstText(description?.plain_text, description?.text, base.description),
    price: firstNumber(detail?.price, base.price),
    currencyId: firstText(detail?.currency_id, base.currencyId),
    permalink: firstText(detail?.permalink, productDetail?.permalink, base.permalink, mercadoLivrePermalinkFromItemId(externalItemId)),
    imageUrl: detailImage ?? productImageUrls[0] ?? base.imageUrl,
    imageUrls: Array.from(new Set([...(detailImage ? [detailImage] : []), ...detailImageUrls, ...productImageUrls, ...base.imageUrls].filter(Boolean))).slice(0, 12),
    categoryId: firstText(detail?.category_id, base.categoryId),
    categoryName: firstText(category?.name, productDetail?.domain_id, base.categoryName),
    categoryPath: categoryPathValue ?? base.categoryPath,
    gtin: pickAttribute(detail?.attributes, ["GTIN", "EAN", "UPC"]) ?? pickAttribute(productDetail?.attributes, ["GTIN", "EAN", "UPC"]) ?? base.gtin,
    brand: pickAttribute(detail?.attributes, ["BRAND", "MARCA"]) ?? pickAttribute(productDetail?.attributes, ["BRAND", "MARCA"]) ?? base.brand,
    partNumber: pickAttribute(detail?.attributes, ["PART_NUMBER", "MPN", "OEM"]) ?? pickAttribute(productDetail?.attributes, ["PART_NUMBER", "MPN", "OEM"]) ?? base.partNumber,
    sellerId,
    sellerName: firstText(seller?.nickname, base.sellerName),
    sellerReputation: firstText(sellerReputation?.power_seller_status, sellerReputation?.level_id, base.sellerReputation),
    sellerReputationLevel: firstText(sellerReputation?.level_id, base.sellerReputationLevel),
    sellerTransactionsTotal: firstNumber(sellerTransactions?.total, base.sellerTransactionsTotal),
    sellerTransactionsCompleted: firstNumber(sellerTransactions?.completed, base.sellerTransactionsCompleted),
    soldQuantity: firstNumber(detail?.sold_quantity, base.soldQuantity),
    condition: firstText(detail?.condition, base.condition),
    location: detailLocation.location ?? base.location,
    stateName: detailLocation.stateName ?? base.stateName,
    cityName: detailLocation.cityName ?? base.cityName,
    listingTypeId,
    listingTypeLabel: listingTypeLabel(listingTypeId),
    status: firstText(detail?.status, productDetail?.status, base.status),
    attributes: mergeAttributes(detailAttributes, productAttributes, base.attributes)
  };
}

function sanitizeMercadoLivreErrorBody(textBody: string) {
  const fallback = { message: null as string | null, error: null as string | null, code: null as string | null, status: null as number | null, blockedBy: null as string | null };
  try {
    const payload = JSON.parse(textBody) as { message?: unknown; error?: unknown; code?: unknown; status?: unknown; blocked_by?: unknown };
    return {
      message: typeof payload.message === "string" ? payload.message.slice(0, 160) : null,
      error: typeof payload.error === "string" ? payload.error.slice(0, 80) : null,
      code: typeof payload.code === "string" ? payload.code.slice(0, 100) : null,
      status: typeof payload.status === "number" ? payload.status : null,
      blockedBy: typeof payload.blocked_by === "string" ? payload.blocked_by.slice(0, 80) : null
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

type MercadoLivreEndpointDiagnostic = {
  endpoint: string;
  apiMode?: MercadoLivreSearchApiMode;
  httpStatus: number;
  status: "ok" | "blocked" | "error";
  error: string | null;
  code: string | null;
  message: string | null;
  blockedBy: string | null;
  requestId: string | null;
  correlationId: string | null;
  results: number;
};

type MercadoLivreSearchType = "GTIN" | "TITLE";
type MercadoLivreSearchApiMode = "product_identifier" | "q";

type MercadoLivreSearchError = {
  httpStatus: number;
  error: string | null;
  code: string | null;
  message: string | null;
  blockedBy: string | null;
  requestId: string | null;
  correlationId: string | null;
};

async function fetchMercadoLivreReadOnly<T>(input: {
  accessToken: string;
  endpoint: string;
  endpointDiagnostics: MercadoLivreEndpointDiagnostic[];
  results?: number;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? mercadoLivreDetailTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${input.endpoint}`, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
      signal: controller.signal
    });
  } catch (error) {
    input.endpointDiagnostics.push({
      endpoint: input.endpoint,
      httpStatus: 0,
      status: "error",
      error: error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error",
      code: null,
      message: "Chamada read-only Mercado Livre nao concluida em tempo seguro.",
      blockedBy: null,
      requestId: null,
      correlationId: null,
      results: 0
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
  const safeHeaders = safeMercadoLivreHeaders(response);

  if (!response.ok) {
    const errorBody = sanitizeMercadoLivreErrorBody(await response.text());
    input.endpointDiagnostics.push({
      endpoint: input.endpoint,
      httpStatus: response.status,
      status: response.status === 403 ? "blocked" : "error",
      error: errorBody.error,
      code: errorBody.code,
      message: errorBody.message,
      blockedBy: errorBody.blockedBy,
      requestId: safeHeaders.requestId,
      correlationId: safeHeaders.correlationId,
      results: 0
    });
    return null;
  }

  const payload = (await response.json()) as T;
  input.endpointDiagnostics.push({
    endpoint: input.endpoint,
    httpStatus: response.status,
    status: "ok",
    error: null,
    code: null,
    message: null,
    blockedBy: null,
    requestId: safeHeaders.requestId,
    correlationId: safeHeaders.correlationId,
    results: input.results ?? 1
  });
  return payload;
}

async function searchMercadoLivreProductsReadOnly(input: {
  accessToken: string;
  siteId: string;
  searchValue: string;
  paging: { page: number; pageSize: number; offset: number };
  endpointDiagnostics: MercadoLivreEndpointDiagnostic[];
  searchType: MercadoLivreSearchType;
}) {
  const apiMode: MercadoLivreSearchApiMode = input.searchType === "GTIN" ? "product_identifier" : "q";
  const productSearchUrl = new URL(`${apiBaseUrl}/products/search`);
  productSearchUrl.searchParams.set("site_id", input.siteId);
  productSearchUrl.searchParams.set(apiMode, input.searchValue);
  productSearchUrl.searchParams.set("limit", String(input.paging.pageSize));
  productSearchUrl.searchParams.set("offset", String(input.paging.offset));

  const response = await fetch(productSearchUrl, {
    headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" }
  });

  if (response.ok) {
    const payload = (await response.json()) as MercadoLivreProductSearchResponse;
    const results = payload.results ?? [];
    const paging = buildMercadoLivrePaging({
      page: input.paging.page,
      pageSize: input.paging.pageSize,
      offset: input.paging.offset,
      resultCount: results.length,
      apiPaging: payload.paging
    });
    input.endpointDiagnostics.push({
      endpoint: "/products/search",
      apiMode,
      httpStatus: response.status,
      status: "ok",
      error: null,
      code: null,
      message: null,
      blockedBy: null,
      ...safeMercadoLivreHeaders(response),
      results: results.length
    });

    return {
      items: results.map((item) => withMercadoLivreDataAvailability(normalizeProductSearchItem(item))),
      paging,
      total: typeof payload.paging?.total === "number" ? payload.paging.total : results.length,
      error: null as MercadoLivreSearchError | null
    };
  }

  const errorBody = sanitizeMercadoLivreErrorBody(await response.text());
  const safeHeaders = safeMercadoLivreHeaders(response);
  const diagnostic = {
    endpoint: "/products/search",
    apiMode,
    httpStatus: response.status,
    status: response.status === 403 ? "blocked" as const : "error" as const,
    error: errorBody.error,
    code: errorBody.code,
    message: errorBody.message,
    blockedBy: errorBody.blockedBy,
    requestId: safeHeaders.requestId,
    correlationId: safeHeaders.correlationId,
    results: 0
  };
  input.endpointDiagnostics.push(diagnostic);

  return {
    items: [],
    paging: buildMercadoLivrePaging({
      page: input.paging.page,
      pageSize: input.paging.pageSize,
      offset: input.paging.offset,
      resultCount: 0
    }),
    total: 0,
    error: {
      httpStatus: response.status,
      error: errorBody.error,
      code: errorBody.code,
      message: errorBody.message,
      blockedBy: errorBody.blockedBy,
      requestId: safeHeaders.requestId,
      correlationId: safeHeaders.correlationId
    } satisfies MercadoLivreSearchError
  };
}

type MercadoLivreSearchPageResult = Awaited<ReturnType<typeof searchMercadoLivreProductsReadOnly>>;

async function enrichMercadoLivreSearchItem(input: {
  item: NormalizedMercadoLivreSearchItem;
  accessToken: string;
  endpointDiagnostics: MercadoLivreEndpointDiagnostic[];
  sellerCache?: Map<string, MercadoLivreSellerResponse | null>;
  categoryCache?: Map<string, MercadoLivreCategoryResponse | null>;
}) {
  const sellerCache = input.sellerCache ?? new Map<string, MercadoLivreSellerResponse | null>();
  const categoryCache = input.categoryCache ?? new Map<string, MercadoLivreCategoryResponse | null>();
  const catalogProductId = input.item.catalogProductId?.trim();
  const productDetail = catalogProductId
    ? await fetchMercadoLivreReadOnly<MercadoLivreProductDetailResponse>({
        accessToken: input.accessToken,
        endpoint: `/products/${encodeURIComponent(catalogProductId)}`,
        endpointDiagnostics: input.endpointDiagnostics
      })
    : null;

  const catalogOffers = catalogProductId
    ? await fetchMercadoLivreReadOnly<MercadoLivreCatalogOffersResponse>({
        accessToken: input.accessToken,
        endpoint: `/products/${encodeURIComponent(catalogProductId)}/items?limit=5`,
        endpointDiagnostics: input.endpointDiagnostics
      })
    : null;
  const catalogOffer = pickBestCatalogOffer(catalogOffers);

  const itemId = firstText(mercadoLivreItemId(catalogOffer), input.item.externalItemId);
  const directItemDetail = itemId
    ? await fetchMercadoLivreReadOnly<MercadoLivreItemDetailResponse>({
        accessToken: input.accessToken,
        endpoint: `/items/${encodeURIComponent(itemId)}`,
        endpointDiagnostics: input.endpointDiagnostics
      })
    : null;
  const description = itemId
    ? await fetchMercadoLivreReadOnly<MercadoLivreItemDescriptionResponse>({
        accessToken: input.accessToken,
        endpoint: `/items/${encodeURIComponent(itemId)}/description`,
        endpointDiagnostics: input.endpointDiagnostics
      })
    : null;
  const detail = mergeMercadoLivreItemDetail(catalogOffer, directItemDetail);

  const sellerId = firstText(detail?.seller_id, input.item.sellerId);
  let seller: MercadoLivreSellerResponse | null = null;
  if (sellerId) {
    if (!sellerCache.has(sellerId)) {
      sellerCache.set(
        sellerId,
        await fetchMercadoLivreReadOnly<MercadoLivreSellerResponse>({
          accessToken: input.accessToken,
          endpoint: `/users/${encodeURIComponent(sellerId)}`,
          endpointDiagnostics: input.endpointDiagnostics
        })
      );
    }
    seller = sellerCache.get(sellerId) ?? null;
  }

  const categoryId = firstText(detail?.category_id, input.item.categoryId);
  let category: MercadoLivreCategoryResponse | null = null;
  if (isMercadoLivreCategoryId(categoryId)) {
    if (!categoryCache.has(categoryId)) {
      categoryCache.set(
        categoryId,
        await fetchMercadoLivreReadOnly<MercadoLivreCategoryResponse>({
          accessToken: input.accessToken,
          endpoint: `/categories/${encodeURIComponent(categoryId)}`,
          endpointDiagnostics: input.endpointDiagnostics
        })
      );
    }
    category = categoryCache.get(categoryId) ?? null;
  }

  return withMercadoLivreDataAvailability(
    mergeMercadoLivreSearchItem(input.item, detail, seller, category, productDetail, description),
    input.endpointDiagnostics
  );
}

export function toSafeMercadoLivreAccount(connection: MercadoLivreConnection) {
  return {
    id: connection.id,
    name: connection.accountAlias ?? connection.name,
    status: connection.status,
    externalUserId: connection.externalUserId,
    sellerNickname: connection.sellerNickname,
    expiresAt: connection.expiresAt,
    lastSyncAt: connection.lastSyncAt,
    connectedAt: connection.connectedAt,
    isDefault: connection.isDefault
  };
}

export class MercadoLivreOAuthService {
  validateEnvironment() {
    const missing = missingEnvCredentialNames();
    return {
      ok: missing.length === 0,
      missing
    };
  }

  async findLatestConnection(organizationId: string) {
    return prisma.mercadoLivreConnection.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" }
    });
  }

  async findConfiguredConnection(organizationId: string) {
    return prisma.mercadoLivreConnection.findFirst({
      where: {
        organizationId,
        clientId: { not: null },
        clientSecretEncrypted: { not: null },
        redirectUri: { not: null },
        configStatus: "READY"
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  async findActiveConnection(organizationId: string, connectionId?: string | null) {
    return prisma.mercadoLivreConnection.findFirst({
      where: {
        organizationId,
        ...(connectionId ? { id: connectionId } : {}),
        status: { in: ["ACTIVE", "EXPIRED"] },
        accessTokenEncrypted: { not: null }
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
  }

  async listSafeAccounts(organizationId: string) {
    const accounts = await prisma.mercadoLivreConnection.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });

    return {
      configured: await this.isConfigured(organizationId),
      accounts: accounts.map(toSafeMercadoLivreAccount)
    };
  }

  async isConfigured(organizationId: string) {
    void organizationId;
    return hasEnvCredentials();
  }

  async getStatus(organizationId: string) {
    const connection = await this.findLatestConnection(organizationId);
    const configured = await this.isConfigured(organizationId);
    return {
      configured,
      envFallbackConfigured: !connection && hasEnvCredentials(),
      data: connection
        ? {
            id: connection.id,
            name: connection.name,
            accountAlias: connection.accountAlias ?? connection.name,
            siteId: connection.siteId,
            status: connection.status,
            statusLabel: statusLabel(connection, configured),
            configStatus: connection.configStatus,
            clientId: connection.clientId,
            clientIdMasked: maskClientId(connection.clientId),
            hasClientSecret: Boolean(connection.clientSecretEncrypted),
            redirectUri: connection.redirectUri,
            taxRate: connection.taxRate?.toString() ?? null,
            orderImportStartDate: connection.orderImportStartDate ? connection.orderImportStartDate.toISOString().slice(0, 10) : null,
            externalUserId: connection.externalUserId,
            sellerNickname: connection.sellerNickname,
            isDefault: connection.isDefault,
            connectedAt: connection.connectedAt,
            updatedAt: connection.updatedAt,
            expiresAt: connection.expiresAt,
            lastRefreshAt: connection.lastRefreshAt,
            lastSyncAt: connection.lastSyncAt,
            lastError: connection.lastError
          }
        : null
    };
  }

  async saveConfig(input: SaveConfigInput) {
    const accountAlias = input.accountAlias.trim();
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret?.trim();
    const redirectUri = input.redirectUri.trim();
    const siteId = input.siteId.trim() || "MLB";

    if (!accountAlias) throw new Error("Apelido da conta é obrigatório.");
    if (!clientId) throw new Error("Client ID é obrigatório.");
    if (!redirectUri) throw new Error("Redirect URI é obrigatório.");
    if (!/^https?:\/\//i.test(redirectUri)) throw new Error("Redirect URI deve começar com http:// ou https://.");

    const current = await this.findLatestConnection(input.organizationId);
    if (!clientSecret && !current?.clientSecretEncrypted) {
      throw new Error("Client Secret é obrigatório.");
    }

    const saved = await prisma.mercadoLivreConnection.upsert({
      where: { id: current?.id ?? "__new_mercado_livre_config__" },
      create: {
        organizationId: input.organizationId,
        userId: input.userId,
        name: accountAlias,
        accountAlias,
        clientId,
        clientSecretEncrypted: encryptSecret(clientSecret ?? ""),
        redirectUri,
        siteId,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        configStatus: "READY",
        status: "PENDING",
        lastError: null
      },
      update: {
        userId: input.userId,
        name: accountAlias,
        accountAlias,
        clientId,
        ...(clientSecret ? { clientSecretEncrypted: encryptSecret(clientSecret) } : {}),
        redirectUri,
        siteId,
        taxRate: normalizeTaxRate(input.taxRate),
        orderImportStartDate: normalizeOrderImportStartDate(input.orderImportStartDate),
        configStatus: "READY",
        status: current?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
        lastError: null
      }
    });

    await audit(input.organizationId, input.userId, "MERCADOLIVRE_CONFIG_SAVE", { connectionId: saved.id, status: "ready" });
    return saved;
  }

  async getCredentialsForOrganization(organizationId: string): Promise<MercadoLivreCredentials | null> {
    void organizationId;
    return getEnvCredentials();
  }

  async getCredentialsForState(stateRecord: { organizationId: string; connectionName: string }) {
    void stateRecord;
    return getEnvCredentials();
  }

  async createOAuthState(input: { organizationId: string; userId: string }) {
    const credentials = await this.getCredentialsForOrganization(input.organizationId);
    if (!credentials) {
      const missing = missingEnvCredentialNames();
      throw new Error(
        missing.length
          ? `Configuracao Mercado Livre incompleta no servidor: ${missing.join(", ")}.`
          : "Configure o Mercado Livre antes de conectar."
      );
    }

    const state = randomBytes(32).toString("base64url");
    await prisma.oAuthState.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        provider: OAuthProvider.MERCADOLIVRE,
        stateHash: hashState(state),
        connectionName: credentials.connectionId ?? "Mercado Livre",
        connectionRole: ConnectionRole.OTHER,
        expiresAt: new Date(Date.now() + stateTtlMs)
      }
    });

    await audit(input.organizationId, input.userId, "MERCADO_LIVRE_CONNECT_START", { source: credentials.source, siteId: credentials.siteId });
    return state;
  }

  async buildAuthorizationUrl(state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) throw new Error("State OAuth Mercado Livre inválido ou expirado.");

    const credentials = await this.getCredentialsForState(stateRecord);
    if (!credentials) throw new Error("Configure o Mercado Livre antes de conectar.");

    const url = new URL(getAuthorizationBaseUrl(credentials.siteId));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", credentials.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async validateOAuthState(state: string) {
    const record = await prisma.oAuthState.findUnique({ where: { stateHash: hashState(state) } });
    if (!record || record.provider !== OAuthProvider.MERCADOLIVRE || record.usedAt || record.expiresAt < new Date()) {
      return null;
    }

    return record;
  }

  async exchangeCodeForToken(code: string, credentials: MercadoLivreCredentials): Promise<MercadoLivreTokenResponse> {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: credentials.redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`Falha ao trocar código Mercado Livre: ${response.status}`);
    }

    return response.json() as Promise<MercadoLivreTokenResponse>;
  }

  async completeCallback(code: string, state: string) {
    const stateRecord = await this.validateOAuthState(state);
    if (!stateRecord) {
      throw new Error("State OAuth Mercado Livre inválido ou expirado.");
    }

    const credentials = await this.getCredentialsForState(stateRecord);
    if (!credentials) throw new Error("Configuração Mercado Livre não encontrada.");

    const tokenResponse = await this.exchangeCodeForToken(code, credentials);
    const seller = await fetchCurrentMercadoLivreUser(tokenResponse.access_token).catch(() => null);
    await prisma.oAuthState.update({ where: { id: stateRecord.id }, data: { usedAt: new Date() } });
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);

    const otherConnectionsWhere: Prisma.MercadoLivreConnectionWhereInput = {
      organizationId: stateRecord.organizationId,
      status: { in: ["ACTIVE", "PENDING", "ERROR", "EXPIRED"] }
    };
    if (credentials.connectionId) otherConnectionsWhere.id = { not: credentials.connectionId };

    await prisma.mercadoLivreConnection.updateMany({
      where: otherConnectionsWhere,
      data: { status: "DISCONNECTED", isDefault: false, accessTokenEncrypted: null, refreshTokenEncrypted: null, expiresAt: null, lastError: null }
    });

    const data = {
      organizationId: stateRecord.organizationId,
      userId: stateRecord.userId,
      name: seller?.nickname ? `Mercado Livre - ${seller.nickname}` : "Mercado Livre",
      accountAlias: seller?.nickname ? `Mercado Livre - ${seller.nickname}` : "Mercado Livre",
      clientId: credentials.clientId,
      redirectUri: credentials.redirectUri,
      siteId: credentials.siteId,
      status: "ACTIVE" as const,
      configStatus: "READY",
      externalUserId: seller?.id ?? (tokenResponse.user_id ? String(tokenResponse.user_id) : null),
      sellerNickname: seller?.nickname ?? null,
      tokenType: tokenResponse.token_type ?? "Bearer",
      accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
      refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
      scope: tokenResponse.scope,
      expiresAt,
      isDefault: true,
      connectedAt: new Date(),
      lastRefreshAt: new Date(),
      lastError: null
    };

    const connection = credentials.connectionId
      ? await prisma.mercadoLivreConnection.update({ where: { id: credentials.connectionId }, data })
      : await prisma.mercadoLivreConnection.create({ data });

    await audit(stateRecord.organizationId, stateRecord.userId, "MERCADO_LIVRE_CONNECT_SUCCESS", {
      connectionId: connection.id,
      status: "success",
      externalUserId: connection.externalUserId,
      sellerNickname: connection.sellerNickname
    });
    return connection;
  }

  async refreshConnectionToken(connectionId: string, organizationId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({ where: { id: connectionId, organizationId } });
    if (!connection?.refreshTokenEncrypted) throw new Error("Conexão Mercado Livre não encontrada.");

    const credentials = await this.getCredentialsForOrganization(organizationId);
    if (!credentials) throw new Error("Configuração Mercado Livre não encontrada.");

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: decryptSecret(connection.refreshTokenEncrypted)
      })
    });

    if (!response.ok) {
      await prisma.mercadoLivreConnection.update({
        where: { id: connection.id },
        data: { status: "EXPIRED", lastError: "Falha ao renovar token Mercado Livre." }
      });
      await audit(organizationId, null, "MERCADO_LIVRE_TOKEN_REFRESH_ERROR", { connectionId: connection.id, status: "error", httpStatus: response.status });
      throw new Error(`Falha ao renovar token Mercado Livre: ${response.status}`);
    }

    const tokenResponse = (await response.json()) as MercadoLivreTokenResponse;
    const expiresAt = new Date(Date.now() + Math.max(0, tokenResponse.expires_in - 60) * 1000);
    await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: {
        status: "ACTIVE",
        accessTokenEncrypted: encryptSecret(tokenResponse.access_token),
        refreshTokenEncrypted: encryptSecret(tokenResponse.refresh_token),
        tokenType: tokenResponse.token_type ?? connection.tokenType,
        scope: tokenResponse.scope ?? connection.scope,
        expiresAt,
        lastRefreshAt: new Date(),
        lastError: null
      }
    });
    await audit(organizationId, null, "MERCADO_LIVRE_TOKEN_REFRESH_SUCCESS", { connectionId: connection.id, status: "success" });
    return tokenResponse.access_token;
  }

  async getAccessTokenForOrganization(organizationId: string) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: { organizationId, status: { in: ["ACTIVE", "EXPIRED"] }, accessTokenEncrypted: { not: null } },
      orderBy: { updatedAt: "desc" }
    });

    if (!connection?.accessTokenEncrypted || !connection.expiresAt) return null;

    if (connection.expiresAt <= new Date()) {
      return this.refreshConnectionToken(connection.id, organizationId);
    }

    return decryptSecret(connection.accessTokenEncrypted);
  }

  async getAccessTokenForConnection(organizationId: string, connectionId?: string | null) {
    const connection = await this.findActiveConnection(organizationId, connectionId);
    if (!connection?.accessTokenEncrypted || !connection.expiresAt) return null;

    const accessToken =
      connection.expiresAt <= new Date()
        ? await this.refreshConnectionToken(connection.id, organizationId)
        : decryptSecret(connection.accessTokenEncrypted);

    return { connection, accessToken };
  }

  async getUnexpiredAccessTokenForConnectionReadOnly(organizationId: string, connectionId?: string | null) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: {
        organizationId,
        ...(connectionId ? { id: connectionId } : {}),
        status: "ACTIVE",
        accessTokenEncrypted: { not: null }
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });
    if (!connection?.accessTokenEncrypted || !connection.expiresAt) return null;
    if (connection.expiresAt <= new Date()) {
      throw new Error("Conta Mercado Livre precisa ser reconectada para consultar este anuncio.");
    }

    return { connection, accessToken: decryptSecret(connection.accessTokenEncrypted) };
  }

  async searchReadOnly(input: {
    authContext: MercadoLivreSearchAuthContext;
    q?: string | null;
    gtin?: string | null;
    searchMode?: string | null;
    connectionId?: string | null;
    page?: string | number | null;
    pageSize?: string | number | null;
  }) {
    const searchStartedAt = Date.now();
    const rawQuery = input.gtin?.trim() || input.q?.trim();
    if (!rawQuery) throw new Error("Informe q ou gtin para buscar no Mercado Livre.");

    const requestedSearchMode = normalizeMercadoLivreSearchMode(input.searchMode);
    const pagingInput = resolveMercadoLivrePagingInput(input.page, input.pageSize);
    const localLookup = await findLocalProductForMercadoLivreSearch(input.authContext, rawQuery);
    const resolvedSearch = resolveMercadoLivreSearch({
      rawQuery,
      requestedMode: requestedSearchMode,
      localProduct: localLookup.product
    });
    const localProduct = toSafeMercadoLivreSearchProduct(localLookup.product, localLookup.matchType);

    if (!resolvedSearch.searchValue) {
      return {
        provider: "MERCADO_LIVRE",
        account: null,
        query: rawQuery,
        requestedSearchMode,
        searchMode: resolvedSearch.searchMode,
        searchType: resolvedSearch.searchType,
        searchValue: null,
        apiMode: null,
        localProduct,
        localProductMatchType: localLookup.matchType,
        warnings: resolvedSearch.warnings,
        paging: buildMercadoLivrePaging({
          page: pagingInput.page,
          pageSize: pagingInput.pageSize,
          offset: pagingInput.offset,
          resultCount: 0
        }),
        readOnly: true,
        externalWrite: false,
        items: []
      };
    }

    const token = await this.getUnexpiredAccessTokenForConnectionReadOnly(input.authContext.organizationId, input.connectionId);
    if (!token) throw new Error("Conecte uma conta Mercado Livre antes de buscar.");

    const warnings = [...resolvedSearch.warnings];
    const endpointDiagnostics: MercadoLivreEndpointDiagnostic[] = [];
    const publicSearchEnabled = false;
    let searchPaging = buildMercadoLivrePaging({
      page: pagingInput.page,
      pageSize: pagingInput.pageSize,
      offset: pagingInput.offset,
      resultCount: 0
    });
    let mercadoLivreError: MercadoLivreSearchError | null = null;
    const firstSearchType = resolvedSearch.searchType;
    const firstSearchValue = resolvedSearch.searchValue;
    let firstSearchTotal: number | null = null;
    let fallbackSearchType: MercadoLivreSearchType | null = null;
    let fallbackSearchValue: string | null = null;
    let fallbackSearchTotal: number | null = null;
    let effectiveSearchType: MercadoLivreSearchType = resolvedSearch.searchType;
    let effectiveSearchValue: string | null = resolvedSearch.searchValue;
    let apiMode: MercadoLivreSearchApiMode = resolvedSearch.searchType === "GTIN" ? "product_identifier" : "q";
    const firstApiMode: MercadoLivreSearchApiMode = apiMode;
    let fallbackApiMode: MercadoLivreSearchApiMode | null = null;
    let fallbackUsed = false;
    let publicSearchStatus: "disabled" | "ok" | "blocked" | "error" | "empty" = "disabled";
    let publicSearchTotal: number | null = null;
    const catalogFallbackUsed = false;
    const catalogFallbackTotal: number | null = null;
    const items: NormalizedMercadoLivreSearchItem[] = [];
    let initialSearchMs = 0;

    const collectSearchPages = async (
      runner: (paging: { page: number; pageSize: number; offset: number }) => Promise<MercadoLivreSearchPageResult>
    ) => {
      const pageStartedAt = Date.now();
      const pageResult = await runner({
        page: pagingInput.page,
        pageSize: pagingInput.pageSize,
        offset: pagingInput.offset
      });
      initialSearchMs += Date.now() - pageStartedAt;
      const boundedItems = pageResult.items.slice(0, pagingInput.pageSize);
      const paging = buildMercadoLivrePaging({
        page: pagingInput.page,
        pageSize: pagingInput.pageSize,
        offset: pagingInput.offset,
        resultCount: boundedItems.length,
        apiPaging: {
          total: pageResult.total ?? boundedItems.length,
          limit: pagingInput.pageSize,
          offset: pagingInput.offset
        }
      });

      return {
        items: boundedItems,
        paging,
        total: pageResult.total ?? boundedItems.length,
        error: pageResult.error
      };
    };

    const runSearchStep = async (searchValue: string, searchType: MercadoLivreSearchType) => {
      const catalogSearch = await collectSearchPages((paging) =>
        searchMercadoLivreProductsReadOnly({
          accessToken: token.accessToken,
          siteId: token.connection.siteId || "MLB",
          searchValue,
          paging,
          endpointDiagnostics,
          searchType
        })
      );
      publicSearchTotal = null;
      publicSearchStatus = "disabled";
      if (catalogSearch.error) mercadoLivreError = mercadoLivreError ?? catalogSearch.error;
      return catalogSearch;
    };

    let titleSearchQueriesAttempted = resolvedSearch.searchType === "TITLE" ? 1 : 0;
    const firstSearch = await runSearchStep(resolvedSearch.searchValue, resolvedSearch.searchType);
    items.push(...firstSearch.items);
    searchPaging = firstSearch.paging;
    mercadoLivreError = mercadoLivreError ?? firstSearch.error;
    firstSearchTotal = firstSearch.total;

    if (requestedSearchMode === "auto" && resolvedSearch.searchType === "GTIN" && firstSearch.total === 0 && !items.length) {
      const titleFallbackValue = localLookup.product?.name?.trim() || null;
      if (titleFallbackValue) {
        warnings.push("Nenhum resultado encontrado pelo identificador do produto. A busca foi refeita automaticamente por titulo.");
        const fallbackSearch = await runSearchStep(titleFallbackValue, "TITLE");
        titleSearchQueriesAttempted = 1;
        items.splice(0, items.length, ...fallbackSearch.items);
        searchPaging = fallbackSearch.paging;
        mercadoLivreError = mercadoLivreError ?? fallbackSearch.error;
        fallbackSearchType = "TITLE";
        fallbackSearchValue = titleFallbackValue;
        fallbackSearchTotal = fallbackSearch.total;
        fallbackApiMode = "q";
        effectiveSearchType = "TITLE";
        effectiveSearchValue = titleFallbackValue;
        apiMode = "q";
        fallbackUsed = true;
        if (fallbackSearch.total === 0 && !fallbackSearch.items.length) {
          warnings.push("Nenhum resultado encontrado por GTIN/EAN ou titulo. Ajuste o termo de busca.");
        }
      }
    } else if (requestedSearchMode === "gtin" && resolvedSearch.searchType === "GTIN" && firstSearch.total === 0 && !items.length && !firstSearch.error) {
      warnings.push("Nenhum produto encontrado no Catalogo Mercado Livre para este GTIN/EAN. Tente buscar por titulo.");
    }

    if (effectiveSearchType === "TITLE" && pagingInput.page === 1) {
      const titleSearchQueries = buildProductReferenceSearchQueries({
        title: localLookup.product?.name?.trim() || effectiveSearchValue || resolvedSearch.searchValue,
        brand: localLookup.product?.brand
      }).slice(0, mercadoLivreTitleSearchMaxQueries);
      const attemptedQueries = new Set(
        [firstSearchType === "TITLE" ? firstSearchValue : null, fallbackSearchValue]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " "))
      );

      for (const searchValue of titleSearchQueries) {
        if (titleSearchQueriesAttempted >= mercadoLivreTitleSearchMaxQueries) break;
        const normalizedSearchValue = searchValue.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
        if (attemptedQueries.has(normalizedSearchValue)) continue;
        attemptedQueries.add(normalizedSearchValue);
        await pauseMercadoLivreTitleSearch();
        const stagedSearch = await runSearchStep(searchValue, "TITLE");
        titleSearchQueriesAttempted += 1;
        items.splice(0, items.length, ...mergeUniqueMercadoLivreSearchItems(items, stagedSearch.items));
        searchPaging = stagedSearch.paging;
        mercadoLivreError = mercadoLivreError ?? stagedSearch.error;
        fallbackSearchType = "TITLE";
        fallbackSearchValue = searchValue;
        fallbackSearchTotal = stagedSearch.total;
        fallbackApiMode = "q";
        effectiveSearchType = "TITLE";
        effectiveSearchValue = searchValue;
        apiMode = "q";
        fallbackUsed = true;
      }

      if (titleSearchQueriesAttempted > 1) {
        warnings.push("A busca por titulo foi refinada mantendo tipo da peca, modelo, aplicacao e marca quando disponiveis.");
      }
    }

    if (mercadoLivreError?.httpStatus === 403) {
      warnings.push(mercadoLivreSearchBlockedWarning);
    }

    const prioritizedSearchItems = prioritizeMercadoLivreSearchItems(items);
    const enrichedItems = prioritizedSearchItems.items;

    return {
      provider: "MERCADO_LIVRE",
      account: toSafeMercadoLivreAccount(token.connection),
      query: rawQuery,
      requestedSearchMode,
      searchMode: resolvedSearch.searchMode,
      searchType: effectiveSearchType,
      searchValue: effectiveSearchValue,
      apiMode,
      firstSearchType,
      firstSearchValue,
      firstSearchTotal,
      firstApiMode,
      fallbackSearchType,
      fallbackSearchValue,
      fallbackSearchTotal,
      fallbackApiMode,
      effectiveSearchType,
      fallbackUsed,
      publicSearchEnabled,
      publicSearchStatus,
      publicSearchTotal,
      catalogFallbackUsed,
      catalogFallbackTotal,
      searchStrategy: {
        titleQueriesAttempted: titleSearchQueriesAttempted,
        maxTitleQueries: mercadoLivreTitleSearchMaxQueries,
        maxPages: 3
      },
      analyzedResultsCount: prioritizedSearchItems.analyzedResultsCount,
      usefulResultsCount: prioritizedSearchItems.usefulResultsCount,
      displayedResultsCount: prioritizedSearchItems.displayedResultsCount,
      hiddenIncompleteResultsCount: prioritizedSearchItems.hiddenIncompleteResultsCount,
      localProduct,
      localProductMatchType: localLookup.matchType,
      warnings,
      mercadoLivreError,
      endpointDiagnostics,
      performance: {
        totalMs: Date.now() - searchStartedAt,
        initialSearchMs,
        enrichmentMs: 0,
        analyzedResultsCount: prioritizedSearchItems.analyzedResultsCount,
        basicResultsCount: items.length,
        detailsMode: "on_demand",
        cacheStatus: "not_used"
      },
      paging: searchPaging,
      apiSearchStatus: mercadoLivreError?.httpStatus === 403 ? "blocked" : mercadoLivreError ? "error" : "ok",
      readOnly: true,
      externalWrite: false,
      items: enrichedItems
    };
  }

  async getReadOnlySearchItemDetail(input: {
    authContext: MercadoLivreSearchAuthContext;
    itemId?: string | null;
    catalogProductId?: string | null;
    connectionId?: string | null;
    basicItem?: Partial<NormalizedMercadoLivreSearchItem>;
    refreshExpiredToken?: boolean;
  }) {
    const normalizedItemId = input.itemId?.trim().toUpperCase() || null;
    const catalogProductId = input.catalogProductId?.trim() || null;
    if (!normalizedItemId && !catalogProductId) throw new Error("Informe itemId ou catalogProductId para carregar detalhes.");

    const token = input.refreshExpiredToken === false
      ? await this.getUnexpiredAccessTokenForConnectionReadOnly(input.authContext.organizationId, input.connectionId)
      : await this.getAccessTokenForConnection(input.authContext.organizationId, input.connectionId);
    if (!token) throw new Error("Conecte uma conta Mercado Livre antes de carregar detalhes.");

    const startedAt = Date.now();
    const endpointDiagnostics: MercadoLivreEndpointDiagnostic[] = [];
    const baseItem: NormalizedMercadoLivreSearchItem = {
      externalItemId: normalizedItemId,
      catalogProductId,
      title: input.basicItem?.title ?? null,
      description: input.basicItem?.description ?? null,
      price: input.basicItem?.price ?? null,
      currencyId: input.basicItem?.currencyId ?? null,
      permalink: input.basicItem?.permalink ?? mercadoLivrePermalinkFromItemId(normalizedItemId),
      imageUrl: input.basicItem?.imageUrl ?? null,
      imageUrls: input.basicItem?.imageUrls ?? [],
      categoryId: input.basicItem?.categoryId ?? null,
      categoryName: input.basicItem?.categoryName ?? null,
      categoryPath: input.basicItem?.categoryPath ?? null,
      gtin: input.basicItem?.gtin ?? null,
      brand: input.basicItem?.brand ?? null,
      partNumber: input.basicItem?.partNumber ?? null,
      sellerId: input.basicItem?.sellerId ?? null,
      sellerName: input.basicItem?.sellerName ?? null,
      sellerReputation: input.basicItem?.sellerReputation ?? null,
      sellerReputationLevel: input.basicItem?.sellerReputationLevel ?? null,
      sellerTransactionsTotal: input.basicItem?.sellerTransactionsTotal ?? null,
      sellerTransactionsCompleted: input.basicItem?.sellerTransactionsCompleted ?? null,
      soldQuantity: input.basicItem?.soldQuantity ?? null,
      condition: input.basicItem?.condition ?? null,
      location: input.basicItem?.location ?? null,
      stateName: input.basicItem?.stateName ?? null,
      cityName: input.basicItem?.cityName ?? null,
      listingTypeId: input.basicItem?.listingTypeId ?? null,
      listingTypeLabel: input.basicItem?.listingTypeLabel ?? null,
      status: input.basicItem?.status ?? null,
      attributes: input.basicItem?.attributes ?? [],
      source: input.basicItem?.source ?? "MERCADO_LIVRE_PRODUCT_SEARCH"
    };

    const item = await enrichMercadoLivreSearchItem({
      item: baseItem,
      accessToken: token.accessToken,
      endpointDiagnostics
    });

    return {
      provider: "MERCADO_LIVRE",
      account: toSafeMercadoLivreAccount(token.connection),
      item,
      endpointDiagnostics,
      performance: {
        totalMs: Date.now() - startedAt,
        detailsMode: "on_demand"
      },
      readOnly: true,
      externalWrite: false
    };
  }

  async disconnectConnection(organizationId: string, userId: string, connectionId?: string | null) {
    const connection = await prisma.mercadoLivreConnection.findFirst({
      where: {
        organizationId,
        ...(connectionId ? { id: connectionId } : {}),
        status: { in: ["ACTIVE", "PENDING", "ERROR", "EXPIRED"] }
      },
      orderBy: { updatedAt: "desc" }
    });
    if (!connection) throw new Error("Conexão Mercado Livre não encontrada.");

    const updated = await prisma.mercadoLivreConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        isDefault: false,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        expiresAt: null,
        lastRefreshAt: null,
        lastError: null
      }
    });
    await audit(organizationId, userId, "MERCADO_LIVRE_CONNECTION_DISCONNECT", { connectionId: connection.id, status: "disconnected" });
    return toSafeMercadoLivreAccount(updated);
  }

  async disconnect(organizationId: string, userId: string) {
    return this.disconnectConnection(organizationId, userId);
  }
}

export const mercadoLivreOAuthService = new MercadoLivreOAuthService();
