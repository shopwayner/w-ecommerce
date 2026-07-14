"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Database, ExternalLink, ImageIcon, PackageSearch, RotateCcw, Search, SlidersHorizontal, WandSparkles, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { IntelligentProductPreview } from "@/components/intelligent-product-preview";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import {
  calculateProductSuggestionCompatibility,
  type ProductCompatibilitySuggestion,
  type ProductSuggestionCompatibilityLevel,
  type ProductSuggestionCompatibilityResult
} from "@/lib/intelligent-product-compatibility";
import {
  AMAZON_DRAFT_FIELDS,
  amazonDraftValueHasContent,
  amazonDraftValuesEqual,
  amazonReferenceSuggestion,
  applyAmazonReferenceSuggestion,
  applyAmazonReferenceToEmptyFields,
  createAmazonReferenceDraft,
  keepAmazonDraftCurrentValue,
  type AmazonCatalogItem,
  type AmazonDraftField,
  type AmazonReferenceDraft
} from "@/lib/amazon-reference-draft";
import {
  buildIntelligentProductPreviewFields,
  normalizeIntelligentProductPreviewBrand,
  normalizeIntelligentProductPreviewImages,
  normalizeIntelligentProductPreviewTitle
} from "@/lib/intelligent-product-preview";

const AMAZON_LOGO_SRC = "/marketplaces/amazon.png";
const MERCADO_LIVRE_LOGO_SRC = "/marketplaces/mercado-livre.png";
const MERCADO_LIVRE_DETAIL_CONCURRENCY = 4;
const MERCADO_LIVRE_DETAIL_TIMEOUT_MS = 15000;
const MERCADO_LIVRE_OFFER_PAGE_MAX_CATALOGS = 80;

function AmazonLogo({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      alt="Amazon"
      className={`shrink-0 object-contain ${className}`}
      height={size}
      src={AMAZON_LOGO_SRC}
      width={size}
    />
  );
}

function MercadoLivreLogo({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      alt="Mercado Livre"
      className={`shrink-0 object-contain ${className}`}
      height={size}
      src={MERCADO_LIVRE_LOGO_SRC}
      width={size}
    />
  );
}

type AuxiliaryPanel = "product" | "extracted" | "history" | null;

type MercadoLivreAccount = {
  id: string;
  name: string | null;
  status: string;
  externalUserId: string | null;
  sellerNickname: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
  isDefault: boolean;
};

type MercadoLivreAccountsResponse = {
  configured: boolean;
  accounts: MercadoLivreAccount[];
  error?: string;
};

type MercadoLivreSearchMode = "auto" | "gtin" | "title";
type MercadoLivreSearchType = "GTIN" | "TITLE";
type MercadoLivreSearchApiMode = "product_identifier" | "q";
type MercadoLivreLocalFilter =
  | "hideIncomplete"
  | "completeData"
  | "withPrice"
  | "withSeller"
  | "hideLowCompatibility"
  | "classic"
  | "premium";
type InternalGtinState = "idle" | "loading" | "found" | "not_found" | "error";
type MercadoLivreSearchState = "idle" | "loading" | "success" | "empty" | "blocked_403" | "error";

const mercadoLivreLocalFilterLabels: Record<MercadoLivreLocalFilter, string> = {
  hideIncomplete: "Ocultar incompletos",
  completeData: "Somente dados completos",
  withPrice: "Somente com preco",
  withSeller: "Somente com vendedor",
  hideLowCompatibility: "Ocultar baixa compatibilidade",
  classic: "Somente Classico",
  premium: "Somente Premium"
};

const mercadoLivreLocalFilterOptions: MercadoLivreLocalFilter[] = [
  "completeData",
  "withPrice",
  "withSeller",
  "hideLowCompatibility",
  "classic",
  "premium"
];

function defaultMercadoLivreLocalFilters() {
  return new Set<MercadoLivreLocalFilter>();
}

type MercadoLivreSearchItem = {
  externalItemId: string | null;
  catalogProductId?: string | null;
  title: string | null;
  description?: string | null;
  sku?: string | null;
  gtin?: string | null;
  price: number | null;
  currencyId?: string | null;
  permalink: string | null;
  imageUrl: string | null;
  imageUrls?: string[];
  images?: unknown;
  pictures?: unknown;
  pictureUrls?: unknown;
  thumbnail?: string | null;
  secure_thumbnail?: string | null;
  secureThumbnail?: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  categoryPath?: string | null;
  brand: string | null;
  partNumber?: string | null;
  sellerId?: string | null;
  sellerName?: string | null;
  sellerReputation?: string | null;
  sellerReputationLevel?: string | null;
  sellerTransactionsTotal?: number | null;
  sellerTransactionsCompleted?: number | null;
  soldQuantity?: number | null;
  condition?: string | null;
  location?: string | null;
  stateName?: string | null;
  cityName?: string | null;
  listingTypeId?: string | null;
  listingTypeLabel?: string | null;
  status?: string | null;
  lastSyncedAt?: string | null;
  attributes?: Array<{ id: string | null; name: string | null; value: string | null }>;
  detailsStatus?: "basic" | "complete";
  dataAvailability?: "complete" | "catalog_offer" | "catalog_without_public_offer" | "partial";
  dataAvailabilityMessage?: string | null;
  source: string;
};

type MercadoLivreCacheStatus = {
  total: number;
  lastSyncedAt: string | null;
  searched?: boolean;
};

type MercadoLivreSearchResponse = {
  provider?: "MERCADO_LIVRE";
  account: MercadoLivreAccount | null;
  query: string;
  requestedSearchMode: MercadoLivreSearchMode;
  searchMode: MercadoLivreSearchMode;
  searchType: MercadoLivreSearchType;
  searchValue: string | null;
  apiMode?: MercadoLivreSearchApiMode | null;
  firstSearchType?: MercadoLivreSearchType | null;
  firstSearchValue?: string | null;
  firstSearchTotal?: number | null;
  firstApiMode?: MercadoLivreSearchApiMode | null;
  fallbackSearchType?: MercadoLivreSearchType | null;
  fallbackSearchValue?: string | null;
  fallbackSearchTotal?: number | null;
  fallbackApiMode?: MercadoLivreSearchApiMode | null;
  effectiveSearchType?: MercadoLivreSearchType | null;
  fallbackUsed?: boolean;
  publicSearchEnabled?: boolean;
  publicSearchStatus?: "disabled" | "ok" | "blocked" | "error" | "empty";
  publicSearchTotal?: number | null;
  catalogFallbackUsed?: boolean;
  catalogFallbackTotal?: number | null;
  analyzedResultsCount?: number;
  usefulResultsCount?: number;
  displayedResultsCount?: number;
  hiddenIncompleteResultsCount?: number;
  localProduct: {
    productId: string;
    sku: string | null;
    name: string;
    gtin: string | null;
    brand: string | null;
    imageUrl: string | null;
    syncStatus: string;
    source: string | null;
    matchType: "SKU" | "GTIN" | "TITLE" | "NONE";
    blingAccount: {
      id: string;
      name: string | null;
      externalProductId: string;
      status: string;
      isDefault: boolean;
    } | null;
  } | null;
  localProductMatchType: "SKU" | "GTIN" | "TITLE" | "NONE";
  warnings: string[];
  mercadoLivreError?: {
    httpStatus: number;
    error: string | null;
    code?: string | null;
    message: string | null;
    blockedBy?: string | null;
    requestId?: string | null;
    correlationId?: string | null;
  } | null;
  endpointDiagnostics?: Array<{
    endpoint: string;
    apiMode?: MercadoLivreSearchApiMode;
    httpStatus: number;
    status: "ok" | "blocked" | "error";
    error: string | null;
    code?: string | null;
    message: string | null;
    blockedBy?: string | null;
    requestId?: string | null;
    correlationId?: string | null;
    results: number;
  }>;
  performance?: {
    totalMs?: number;
    initialSearchMs?: number;
    enrichmentMs?: number;
    analyzedResultsCount?: number;
    basicResultsCount?: number;
    detailsMode?: "on_demand" | string;
    cacheStatus?: string;
  };
  paging?: {
    total: number | null;
    limit: number;
    offset: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  apiSearchStatus?: "ok" | "blocked" | "disabled" | "error" | "cache";
  mercadoLivreCacheStatus?: MercadoLivreCacheStatus;
  readOnly: boolean;
  externalWrite: boolean;
  items: MercadoLivreSearchItem[];
  error?: string;
};

type MercadoLivreItemDetailResponse = {
  item?: MercadoLivreSearchItem;
  performance?: {
    totalMs?: number;
    detailsMode?: "on_demand" | string;
  };
  readOnly?: boolean;
  externalWrite?: boolean;
  error?: string;
};

type MercadoLivreReferenceImport = {
  id: string;
  productId: string | null;
  externalItemId: string;
  title: string | null;
  description: string | null;
  gtin: string | null;
  brand: string | null;
  partNumber: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  currencyId: string | null;
  permalink: string | null;
  thumbnail: string | null;
  pictures: unknown;
  attributes: unknown;
  status: string;
  source: string;
};

type MercadoLivreReferenceDiagnostic = {
  endpoint: string;
  status: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  correlationId: string | null;
};

type MercadoLivreReferenceImportResponse = {
  reference?: MercadoLivreReferenceImport;
  normalizedItemId?: string;
  warnings?: string[];
  readOnly?: boolean;
  externalWrite?: boolean;
  diagnostic?: MercadoLivreReferenceDiagnostic | null;
  diagnostics?: MercadoLivreReferenceDiagnostic[];
  originalUrl?: string | null;
  error?: string;
};

type SafeProduct = {
  productId: string;
  sku: string | null;
  name: string;
  gtin: string | null;
  brand: string | null;
  description: string | null;
  ncm: string | null;
  imageUrl: string | null;
  weight: string | null;
  height: string | null;
  width: string | null;
  depth: string | null;
  price: string | null;
  stock: number;
  status: string;
  syncStatus: string;
  source: string | null;
  blingAccount: {
    id: string;
    name: string | null;
    shortId: string;
    externalProductId: string;
    status: string;
    isDefault: boolean;
  } | null;
  mercadoLivre: {
    mappingId: string;
    status: string;
    marketplaceCategoryId: string | null;
    marketplaceCategoryName: string | null;
    marketplaceCategoryPath: string | null;
    confidenceScore: number | null;
    requiredAttributesSynced: boolean;
    attributeValues: Array<{
      attributeId: string;
      attributeName: string;
      value: string | null;
      status: string;
    }>;
  } | null;
};

type SafeGtinCatalog = {
  id: string;
  gtin: string;
  normalizedGtin: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  ncm: string | null;
  unit: string | null;
  imageUrl: string | null;
  weight: string | null;
  height: string | null;
  width: string | null;
  depth: string | null;
  source: string;
  sourceUrl: string | null;
  confidenceScore: number;
  approved: boolean;
};

type GtinSearchPayload = {
  found: boolean;
  id?: string | null;
  gtin?: string | null;
  normalizedGtin?: string | null;
  name?: string | null;
  title?: string | null;
  optimizedTitle?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  unit?: string | null;
  ncm?: string | null;
  weight?: string | null;
  height?: string | null;
  width?: string | null;
  depth?: string | null;
  imageUrls?: string[];
  confidenceScore?: number | null;
  approved?: boolean | null;
  source?: string | null;
  catalogSource?: string | null;
  message?: string;
  error?: string;
};

type AmazonCatalogResponse = {
  success: boolean;
  data?: {
    source: "AMAZON";
    environment: "sandbox";
    items: AmazonCatalogItem[];
  };
  error?: string;
};

type AmazonCatalogState = "idle" | "loading" | "success" | "empty" | "unavailable" | "error";

function amazonAttributeLabel(value: string) {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase() : "Caracteristica";
}

function amazonDraftDisplayValue(
  field: AmazonDraftField,
  value: string | Record<string, string | string[]>
) {
  if (field === "attributes" && typeof value !== "string") {
    const count = Object.keys(value).length;
    return count ? `${count} característica(s)` : "-";
  }
  return typeof value === "string" && value.trim() ? value : "-";
}

const amazonDraftFieldLabels: Record<AmazonDraftField, string> = {
  name: "Título sugerido",
  brand: "Marca",
  productType: "Tipo do produto",
  attributes: "Características"
};

type InternalGtinDiagnostic = {
  selectedProductSku: string | null;
  selectedProductGtin: string | null;
  productGtin: string | null;
  normalizedGtin: string | null;
  internalGtinLastQuery: string | null;
  internalGtinStatus: InternalGtinState;
  endpoint: string;
  foundCount: number;
  foundId: string | null;
};

type SourceResult = {
  type: "PRODUCT" | "GTIN_CATALOG";
  id: string;
  name: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  imageUrl: string | null;
  source: string;
  confidenceScore: number;
};

type FieldSuggestion = {
  field: string;
  label: string;
  currentValue: string | number | null;
  suggestedValue: string | number | null;
  source: string | null;
  confidence: number | null;
  selectable: boolean;
  selectedByDefault: boolean;
  warning: string | null;
};

type LookupResponse = {
  query: string;
  product: SafeProduct | null;
  productMatchType: "SKU" | "GTIN" | "TITLE" | "NONE";
  gtinCatalog: SafeGtinCatalog | null;
  sourceResults: SourceResult[];
  fieldSuggestions: FieldSuggestion[];
  externalSources: {
    mercadoLivre: { enabled: boolean; status: string };
    amazon: { enabled: boolean; status: string };
  };
  readOnly: boolean;
  externalLookup: boolean;
  messages: string[];
  error?: string;
};

type ProductEnrichmentHistoryItem = {
  id: string;
  createdAt: string;
  productId: string;
  productSku: string | null;
  productName: string;
  userId: string | null;
  userName: string;
  sourceProvider: string;
  sourceExternalId: string | null;
  sourceUrl: string | null;
  compatibilityLevel: ProductSuggestionCompatibilityLevel | null;
  compatibilityScore: number | null;
  confirmationMainUsed: boolean;
  confirmationLowCompatibilityUsed: boolean;
  fieldsChanged: string[];
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
};

type ProductEnrichmentHistoryResponse = {
  items: ProductEnrichmentHistoryItem[];
  externalWrite: boolean;
  blingApiCall: boolean;
  marketplaceApiCall: boolean;
  error?: string;
};

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "Sem dado";
  return String(value);
}

function internalGtinStatusLabel(status: InternalGtinState) {
  if (status === "found") return "encontrado";
  if (status === "not_found") return "nao catalogado";
  if (status === "loading") return "consultando";
  if (status === "error") return "erro de consulta interna";
  return "idle";
}

function mercadoLivreStatusLabel(status: MercadoLivreSearchState) {
  if (status === "success") return "resultados";
  if (status === "empty") return "sem resultados";
  if (status === "blocked_403") return "403 bloqueado pela API";
  if (status === "loading") return "consultando";
  if (status === "error") return "erro de consulta";
  return "idle";
}

function normalizeGtinInput(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function gtinSearchPayloadToSafeCatalog(payload: GtinSearchPayload): SafeGtinCatalog | null {
  if (!payload.found || !payload.id || !payload.normalizedGtin) return null;

  return {
    id: payload.id,
    gtin: payload.gtin ?? payload.normalizedGtin,
    normalizedGtin: payload.normalizedGtin,
    name: payload.name ?? payload.optimizedTitle ?? payload.title ?? payload.normalizedGtin,
    brand: payload.brand ?? null,
    category: payload.category ?? null,
    description: payload.description ?? null,
    ncm: payload.ncm ?? null,
    unit: payload.unit ?? null,
    imageUrl: payload.imageUrls?.[0] ?? null,
    weight: payload.weight ?? null,
    height: payload.height ?? null,
    width: payload.width ?? null,
    depth: payload.depth ?? null,
    source: payload.catalogSource ?? "Banco mestre GTIN do SaaS",
    sourceUrl: null,
    confidenceScore: payload.confidenceScore ?? 0,
    approved: Boolean(payload.approved)
  };
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number") return "Sem valor";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Sem data";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatHistoryValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sem dado";
  if (Array.isArray(value)) return value.length ? value.map((item) => formatHistoryValue(item)).join(" | ") : "Nenhum";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function searchTypeLabel(value: MercadoLivreSearchType | null | undefined) {
  return value === "GTIN" ? "GTIN/EAN" : "titulo";
}

function effectiveMercadoLivreSearchType(search: MercadoLivreSearchResponse | null) {
  return search?.effectiveSearchType ?? search?.searchType ?? null;
}

function effectiveMercadoLivreSearchValue(search: MercadoLivreSearchResponse | null) {
  if (search?.fallbackUsed && search.fallbackSearchValue) return search.fallbackSearchValue;
  return search?.searchValue ?? search?.fallbackSearchValue ?? null;
}

function isMercadoLivreSearchUnavailable(search: MercadoLivreSearchResponse | null) {
  if (!search) return false;
  return search.apiSearchStatus === "blocked" || search.mercadoLivreError?.httpStatus === 403;
}

function isMercadoLivreGtinCatalogEmpty(search: MercadoLivreSearchResponse | null) {
  if (!search) return false;
  return (
    search.apiMode === "product_identifier" &&
    effectiveMercadoLivreSearchType(search) === "GTIN" &&
    search.items.length === 0 &&
    (search.paging?.total === 0 || search.firstSearchTotal === 0)
  );
}

function mercadoLivrePrimaryNotice(search: MercadoLivreSearchResponse | null) {
  if (!search) return null;

  const effectiveType = effectiveMercadoLivreSearchType(search);
  if (effectiveType === "GTIN" && !search.items.length) {
    return "Nenhum produto encontrado no Catálogo Mercado Livre para este GTIN/EAN. Você pode tentar buscar pelo título do produto.";
  }

  if (search.catalogFallbackUsed) {
    return "Exibindo resultados de catalogo em modo read-only.";
  }

  if (isMercadoLivreSearchUnavailable(search)) {
    return "O Catalogo Mercado Livre recusou a consulta read-only no momento. A busca local continua disponivel.";
  }

  return null;
}

function mercadoLivrePublicSearchUrl(value: string | null | undefined) {
  if (!value) return null;
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(value)}`;
}

function mercadoLivreItemPublicUrl(item: MercadoLivreSearchItem) {
  if (item.permalink) return item.permalink;
  const id = item.externalItemId?.trim();
  if (id && /^MLB\d+$/i.test(id)) return `https://produto.mercadolivre.com.br/MLB-${id.replace(/^MLB/i, "")}`;
  if (item.catalogProductId && /^MLB\d+$/i.test(item.catalogProductId)) return `https://www.mercadolivre.com.br/p/${item.catalogProductId.toUpperCase()}`;
  if (!id) return null;
  return mercadoLivrePublicSearchUrl(id);
}

function mercadoLivreSourceLabel(source: string | null | undefined) {
  if (source === "MERCADO_LIVRE_PRODUCT_SEARCH") return "Catalogo Mercado Livre";
  if (source === "MERCADO_LIVRE_PUBLIC_SEARCH") return "Busca publica Mercado Livre";
  return "Mercado Livre read-only";
}

function mercadoLivreSearchResultLabel(search: MercadoLivreSearchResponse, searchType: MercadoLivreSearchType | null, searchValue: string | null) {
  if (!searchValue) return "Mercado Livre nao foi consultado automaticamente.";

  if (isMercadoLivreGtinCatalogEmpty(search)) {
    return `Busca realizada por GTIN/EAN: ${searchValue}`;
  }

  const sourceLabel =
    search.apiMode === "product_identifier"
      ? "Resultados encontrados no Catalogo Mercado Livre"
      : search.apiMode === "q"
        ? "Resultados encontrados no Catalogo Mercado Livre"
        : search.catalogFallbackUsed
          ? "Resultados encontrados no catalogo Mercado Livre"
          : "Resultados encontrados";

  return `${sourceLabel} por ${searchTypeLabel(searchType)}: ${searchValue}`;
}

function localLookupMessage(payload: LookupResponse) {
  if (payload.product) {
    const matchLabel =
      payload.productMatchType === "SKU"
        ? "SKU"
        : payload.productMatchType === "GTIN"
          ? "GTIN/EAN"
          : payload.productMatchType === "TITLE"
            ? "titulo"
            : "dados locais";

    return `Produto local encontrado por ${matchLabel}. Escolha uma fonte para consultar GTIN interno ou Mercado Livre. Nenhuma consulta externa foi realizada.`;
  }

  return payload.error ?? "Nenhum produto local foi localizado. Nenhuma consulta externa foi realizada.";
}

function confidenceTone(confidence: number | null) {
  if (confidence === null) return "muted" as const;
  if (confidence >= 80) return "success" as const;
  if (confidence >= 60) return "warning" as const;
  return "danger" as const;
}

function compatibilityTone(level: ProductSuggestionCompatibilityLevel) {
  if (level === "HIGH") return "success" as const;
  if (level === "MEDIUM") return "warning" as const;
  if (level === "LOW") return "danger" as const;
  return "muted" as const;
}

function compactBadgeClass(tone: "success" | "info" | "warning" | "danger" | "muted") {
  const base = "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-3 ring-1";
  if (tone === "success") return `${base} bg-green-500/12 text-green-700 ring-green-500/25 dark:text-green-300`;
  if (tone === "warning") return `${base} bg-orange-500/12 text-orange-700 ring-orange-500/25 dark:text-orange-300`;
  if (tone === "danger") return `${base} bg-red-500/12 text-red-700 ring-red-500/25 dark:text-red-300`;
  if (tone === "muted") return `${base} bg-matrix-muted/10 text-matrix-muted ring-matrix-border`;
  return `${base} bg-matrix-goldSoft/55 text-matrix-goldDark ring-matrix-gold/25 dark:text-matrix-goldDark`;
}

function mercadoLivreItemToCompatibilitySuggestion(item: MercadoLivreSearchItem): ProductCompatibilitySuggestion {
  return {
    sourceType: item.source,
    sourceExternalId: item.externalItemId,
    sourceUrl: item.permalink,
    title: item.title,
    gtin: item.gtin,
    brand: item.brand,
    categoryId: item.categoryId,
    categoryName: item.categoryName ?? null,
    categoryPath: item.categoryName ?? item.categoryId,
    attributes: item.attributes?.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      value: attribute.value
    }))
  };
}

function CompatibilityDetails({
  compatibility,
  localProduct,
  compact = false
}: {
  compatibility: ProductSuggestionCompatibilityResult;
  localProduct: SafeProduct | null;
  compact?: boolean;
}) {
  return (
    <div className={`mt-2 rounded-md border border-matrix-border bg-matrix-panel2/60 ${compact ? "p-2 text-[11px]" : "p-3 text-xs"} text-matrix-muted`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={compatibilityTone(compatibility.level)}>{compatibility.label}</Badge>
        {compatibility.score !== null ? <span>Score {compatibility.score}/100</span> : <span>Score indisponivel</span>}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {compatibility.gtin.local ?? localProduct?.gtin ? <span>GTIN local: {compatibility.gtin.local ?? localProduct?.gtin}</span> : null}
        {compatibility.gtin.suggestion ? <span>GTIN sugestao: {compatibility.gtin.suggestion}</span> : null}
        {compatibility.brand.local ?? localProduct?.brand ? <span>Marca local: {compatibility.brand.local ?? localProduct?.brand}</span> : null}
        {compatibility.brand.suggestion ? <span>Marca sugestao: {compatibility.brand.suggestion}</span> : null}
      </div>
      {compatibility.matchedWords.length ? (
        <p className="mt-2">Palavras em comum: {compatibility.matchedWords.join(", ")}</p>
      ) : null}
      {compatibility.missingWords.length ? (
        <p className="mt-1 text-matrix-goldDark">Palavras ausentes do titulo sugerido: {compatibility.missingWords.join(", ")}</p>
      ) : null}
      {compatibility.suggestionOnlyWords.length && !compact ? (
        <p className="mt-1">Termos so na sugestao: {compatibility.suggestionOnlyWords.join(", ")}</p>
      ) : null}
      {compatibility.level === "LOW" ? (
        <p className="mt-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-red-100">
          A sugestao pode ser de outro produto ou modelo. Revise titulo, aplicacao, marca, GTIN e imagens antes de salvar.
        </p>
      ) : null}
    </div>
  );
}

function ProductImage({ src, alt, size = "md" }: { src: string | null | undefined; alt: string; size?: "sm" | "md" }) {
  const imageSize = size === "sm" ? 56 : 64;
  return (
    <span className={`${size === "sm" ? "h-14 w-14" : "h-16 w-16"} grid shrink-0 place-items-center overflow-hidden rounded-md border border-matrix-border bg-white`}>
      {src ? <Image alt={alt} className="h-full w-full object-contain" height={imageSize} src={src} unoptimized width={imageSize} /> : <ImageIcon className="h-6 w-6 text-matrix-muted" />}
    </span>
  );
}

function ProductHeroImage({ src, alt }: { src: string | null | undefined; alt: string }) {
  return (
    <span className="grid min-h-48 w-full place-items-center overflow-hidden rounded-lg border border-matrix-border bg-white p-2 sm:min-h-64">
      {src ? <Image alt={alt} className="max-h-64 w-full object-contain" height={280} src={src} unoptimized width={360} /> : <ImageIcon className="h-10 w-10 text-matrix-muted" />}
    </span>
  );
}

function imageUrlsFromUnknown(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) {
    if (typeof value === "object") {
      const fields = value as Record<string, unknown>;
      return [
        fields.secure_url,
        fields.secureUrl,
        fields.url,
        fields.src,
        fields.imageUrl,
        fields.thumbnail,
        fields.secure_thumbnail,
        fields.secureThumbnail
      ].flatMap(imageUrlsFromUnknown);
    }
    return [];
  }
  return value.flatMap(imageUrlsFromUnknown);
}

function mercadoLivreDetailImageUrls(item: MercadoLivreSearchItem) {
  const urls = [
    ...imageUrlsFromUnknown(item.pictures),
    ...imageUrlsFromUnknown(item.images),
    ...imageUrlsFromUnknown(item.pictureUrls),
    ...imageUrlsFromUnknown(item.imageUrls),
    ...imageUrlsFromUnknown(item.imageUrl),
    ...imageUrlsFromUnknown(item.thumbnail),
    ...imageUrlsFromUnknown(item.secure_thumbnail),
    ...imageUrlsFromUnknown(item.secureThumbnail)
  ];
  return Array.from(new Set(urls.filter((url) => /^https?:\/\//i.test(url))));
}

function MercadoLivreImageGallery({ item, alt }: { item: MercadoLivreSearchItem; alt: string }) {
  const images = useMemo(() => mercadoLivreDetailImageUrls(item), [item]);
  const imagesKey = images.join("|");
  const firstImage = images[0] ?? null;
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(images[0] ?? null);
  const [zoom, setZoom] = useState({ active: false, x: 50, y: 50 });

  useEffect(() => {
    setSelectedImageUrl(firstImage);
    setZoom({ active: false, x: 50, y: 50 });
  }, [firstImage, imagesKey]);

  function moveZoom(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selectedImageUrl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    setZoom({ active: true, x, y });
  }

  const selected = selectedImageUrl ?? images[0] ?? null;

  return (
    <div className="min-w-0">
      <div
        className="grid min-h-48 w-full cursor-zoom-in place-items-center overflow-hidden rounded-lg border border-matrix-gold/35 bg-white p-2 sm:min-h-64"
        onMouseLeave={() => setZoom((current) => ({ ...current, active: false }))}
        onMouseMove={moveZoom}
      >
        {selected ? (
          <Image
            alt={alt}
            className="max-h-64 w-full object-contain transition-transform duration-150 ease-out"
            height={280}
            src={selected}
            style={{
              transform: zoom.active ? "scale(1.8)" : "scale(1)",
              transformOrigin: `${zoom.x}% ${zoom.y}%`
            }}
            unoptimized
            width={360}
          />
        ) : (
          <ImageIcon className="h-10 w-10 text-matrix-muted" />
        )}
      </div>
      {images.length ? (
        <div className="matrix-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
          {images.map((imageUrl, imageIndex) => {
            const active = imageUrl === selected;
            return (
              <button
                key={`${imageUrl}-${imageIndex}`}
                aria-label={`Ver imagem ${imageIndex + 1} do anuncio`}
                aria-pressed={active}
                className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-white p-1 transition ${
                  active ? "border-matrix-gold shadow-gold" : "border-matrix-border hover:border-matrix-gold/60"
                }`}
                onClick={() => {
                  setSelectedImageUrl(imageUrl);
                  setZoom({ active: false, x: 50, y: 50 });
                }}
                type="button"
              >
                <Image alt={`Miniatura ${imageIndex + 1} de ${alt}`} className="h-full w-full object-contain" height={56} src={imageUrl} unoptimized width={56} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function mercadoLivreItemKey(item: MercadoLivreSearchItem, index: number) {
  return `${item.externalItemId ?? item.permalink ?? item.title ?? "resultado"}-${index}`;
}

function mercadoLivreDetailCacheKey(item: MercadoLivreSearchItem) {
  if (item.source === "MERCADO_LIVRE_PRODUCT_SEARCH" && item.catalogProductId) return item.catalogProductId;
  return item.externalItemId ?? item.catalogProductId ?? item.permalink ?? null;
}

function isSameMercadoLivreItem(left: MercadoLivreSearchItem, right: MercadoLivreSearchItem) {
  if (left.externalItemId && right.externalItemId) return left.externalItemId === right.externalItemId;
  if (left.catalogProductId && right.catalogProductId) return left.catalogProductId === right.catalogProductId;
  if (left.permalink && right.permalink) return left.permalink === right.permalink;
  return false;
}

function mergeUniqueMercadoLivreSearchItems(current: MercadoLivreSearchItem[], incoming: MercadoLivreSearchItem[]) {
  const seen = new Set<string>();
  const merged: MercadoLivreSearchItem[] = [];

  for (const item of [...current, ...incoming]) {
    const key =
      mercadoLivreDetailCacheKey(item) ??
      item.externalItemId ??
      item.catalogProductId ??
      `${item.title ?? ""}-${item.gtin ?? ""}-${item.imageUrl ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function mercadoLivreContinuationSearchMode(search: MercadoLivreSearchResponse): MercadoLivreSearchMode {
  const effectiveType = search.effectiveSearchType ?? search.searchType;
  if (effectiveType === "TITLE") return "title";
  if (effectiveType === "GTIN") return "gtin";
  return search.requestedSearchMode ?? search.searchMode;
}

function detailTextOrCurrent(detailValue: string | null | undefined, currentValue: string | null | undefined) {
  return detailValue?.trim() ? detailValue : currentValue ?? null;
}

function setMercadoLivreDetailTextParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

function setMercadoLivreDetailNumberParam(params: URLSearchParams, key: string, value: number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) params.set(key, String(value));
}

function appendMercadoLivreBasicDetailParams(params: URLSearchParams, item: MercadoLivreSearchItem) {
  setMercadoLivreDetailTextParam(params, "title", item.title);
  setMercadoLivreDetailTextParam(params, "description", item.description);
  setMercadoLivreDetailNumberParam(params, "price", item.price);
  setMercadoLivreDetailTextParam(params, "currencyId", item.currencyId);
  setMercadoLivreDetailTextParam(params, "permalink", item.permalink);
  setMercadoLivreDetailTextParam(params, "imageUrl", item.imageUrl ?? item.thumbnail ?? item.imageUrls?.[0] ?? null);
  setMercadoLivreDetailTextParam(params, "categoryId", item.categoryId);
  setMercadoLivreDetailTextParam(params, "categoryName", item.categoryName);
  setMercadoLivreDetailTextParam(params, "categoryPath", item.categoryPath);
  setMercadoLivreDetailTextParam(params, "gtin", item.gtin);
  setMercadoLivreDetailTextParam(params, "brand", item.brand);
  setMercadoLivreDetailTextParam(params, "partNumber", item.partNumber);
  setMercadoLivreDetailTextParam(params, "sellerId", item.sellerId);
  setMercadoLivreDetailTextParam(params, "sellerName", item.sellerName);
  setMercadoLivreDetailTextParam(params, "sellerReputation", item.sellerReputation);
  setMercadoLivreDetailTextParam(params, "sellerReputationLevel", item.sellerReputationLevel);
  setMercadoLivreDetailNumberParam(params, "sellerTransactionsTotal", item.sellerTransactionsTotal);
  setMercadoLivreDetailNumberParam(params, "sellerTransactionsCompleted", item.sellerTransactionsCompleted);
  setMercadoLivreDetailNumberParam(params, "soldQuantity", item.soldQuantity);
  setMercadoLivreDetailTextParam(params, "condition", item.condition);
  setMercadoLivreDetailTextParam(params, "location", item.location);
  setMercadoLivreDetailTextParam(params, "stateName", item.stateName);
  setMercadoLivreDetailTextParam(params, "cityName", item.cityName);
  setMercadoLivreDetailTextParam(params, "listingTypeId", item.listingTypeId);
  setMercadoLivreDetailTextParam(params, "listingTypeLabel", item.listingTypeLabel);
  setMercadoLivreDetailTextParam(params, "status", item.status);
  setMercadoLivreDetailTextParam(params, "source", item.source);
  if (item.attributes?.length) {
    params.set("attributesJson", JSON.stringify(item.attributes.slice(0, 20)));
  }
}

function mergeMercadoLivreDetailForUi(current: MercadoLivreSearchItem, detail: MercadoLivreSearchItem): MercadoLivreSearchItem {
  return {
    ...current,
    ...detail,
    externalItemId: detail.externalItemId ?? current.externalItemId,
    catalogProductId: detail.catalogProductId ?? current.catalogProductId,
    title: detailTextOrCurrent(detail.title, current.title),
    description: detailTextOrCurrent(detail.description, current.description),
    price: typeof detail.price === "number" ? detail.price : current.price,
    currencyId: detailTextOrCurrent(detail.currencyId, current.currencyId),
    permalink: detailTextOrCurrent(detail.permalink, current.permalink),
    imageUrl: detailTextOrCurrent(detail.imageUrl, current.imageUrl),
    imageUrls: detail.imageUrls?.length ? detail.imageUrls : current.imageUrls,
    categoryId: detailTextOrCurrent(detail.categoryId, current.categoryId),
    categoryName: detailTextOrCurrent(detail.categoryName, current.categoryName),
    categoryPath: detailTextOrCurrent(detail.categoryPath, current.categoryPath),
    gtin: detailTextOrCurrent(detail.gtin, current.gtin),
    brand: detailTextOrCurrent(detail.brand, current.brand),
    partNumber: detailTextOrCurrent(detail.partNumber, current.partNumber),
    sellerId: detailTextOrCurrent(detail.sellerId, current.sellerId),
    sellerName: detailTextOrCurrent(detail.sellerName, current.sellerName),
    sellerReputation: detailTextOrCurrent(detail.sellerReputation, current.sellerReputation),
    sellerReputationLevel: detailTextOrCurrent(detail.sellerReputationLevel, current.sellerReputationLevel),
    sellerTransactionsTotal: detail.sellerTransactionsTotal ?? current.sellerTransactionsTotal,
    sellerTransactionsCompleted: detail.sellerTransactionsCompleted ?? current.sellerTransactionsCompleted,
    soldQuantity: detail.soldQuantity ?? current.soldQuantity,
    condition: detailTextOrCurrent(detail.condition, current.condition),
    location: detailTextOrCurrent(detail.location, current.location),
    stateName: detailTextOrCurrent(detail.stateName, current.stateName),
    cityName: detailTextOrCurrent(detail.cityName, current.cityName),
    listingTypeId: detailTextOrCurrent(detail.listingTypeId, current.listingTypeId),
    listingTypeLabel: detailTextOrCurrent(detail.listingTypeLabel, current.listingTypeLabel),
    status: detailTextOrCurrent(detail.status, current.status),
    attributes: detail.attributes?.length ? detail.attributes : current.attributes,
    dataAvailability: detail.dataAvailability ?? current.dataAvailability,
    dataAvailabilityMessage: detailTextOrCurrent(detail.dataAvailabilityMessage, current.dataAvailabilityMessage),
    detailsStatus: "complete"
  };
}

function optionalItemText(item: MercadoLivreSearchItem, keys: string[]) {
  const fields = item as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "Sim" : "Nao";
  }
  return null;
}

function mercadoLivreSellerLabel(item: MercadoLivreSearchItem) {
  return optionalItemText(item, ["sellerName", "sellerNickname", "seller", "sellerId", "sellerCustomField"]);
}

function mercadoLivreReputationLabel(item: MercadoLivreSearchItem) {
  return optionalItemText(item, ["sellerReputation", "sellerReputationLevel", "reputation", "sellerLevel"]);
}

function mercadoLivreSalesLabel(item: MercadoLivreSearchItem) {
  if (typeof item.soldQuantity === "number") return `${item.soldQuantity.toLocaleString("pt-BR")} venda(s)`;
  if (typeof item.sellerTransactionsCompleted === "number") return `${item.sellerTransactionsCompleted.toLocaleString("pt-BR")} transações concluídas`;
  if (typeof item.sellerTransactionsTotal === "number") return `${item.sellerTransactionsTotal.toLocaleString("pt-BR")} transações`;
  const value = optionalItemText(item, ["soldQuantity", "soldCount", "sales", "sold", "soldQuantityText", "salesCount"]);
  if (!value) return null;
  if (/^\d+$/.test(value)) return `${Number(value).toLocaleString("pt-BR")} venda(s)`;
  return value;
}

function mercadoLivreLocationLabel(item: MercadoLivreSearchItem) {
  const direct = optionalItemText(item, ["location", "sellerLocation"]);
  if (direct) return direct;
  const city = optionalItemText(item, ["city", "sellerCity"]);
  const state = optionalItemText(item, ["state", "sellerState"]);
  return [city, state].filter(Boolean).join(" - ") || null;
}

function mercadoLivreConditionLabel(item: MercadoLivreSearchItem) {
  const value = optionalItemText(item, ["condition", "itemCondition"]) ?? item.status ?? null;
  if (value === "new") return "Novo";
  if (value === "used") return "Usado";
  if (value === "active") return "Ativo";
  if (value === "paused") return "Pausado";
  if (value === "closed") return "Encerrado";
  return value;
}

function mercadoLivreListingTypeLabel(item: MercadoLivreSearchItem) {
  return optionalItemText(item, ["listingTypeLabel", "listingTypeId"]);
}

function isTechnicalMercadoLivreCategory(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return false;
  return /^ML[A-Z]+[-_][A-Z0-9_]+$/i.test(normalized);
}

function mercadoLivreCategoryLabel(item: MercadoLivreSearchItem) {
  const categoryPath = item.categoryPath?.trim();
  if (categoryPath && !isTechnicalMercadoLivreCategory(categoryPath)) return categoryPath;

  const categoryName = item.categoryName?.trim();
  if (categoryName && !isTechnicalMercadoLivreCategory(categoryName)) return categoryName;

  const categoryId = item.categoryId?.trim();
  if (categoryId && /^ML[A-Z]\d+$/i.test(categoryId)) return categoryId;

  return null;
}

function mercadoLivreDataCompleteness(item: MercadoLivreSearchItem) {
  const hasTitle = Boolean(item.title?.trim());
  const hasImage = Boolean(item.imageUrl || item.thumbnail || item.imageUrls?.length);
  const hasPrice = typeof item.price === "number";
  const hasExternalReference = Boolean(item.permalink || item.externalItemId);
  const hasCategory = Boolean(mercadoLivreCategoryLabel(item));
  const hasSeller = Boolean(mercadoLivreSellerLabel(item));

  if (hasTitle && hasImage && hasPrice && hasExternalReference && hasCategory && hasSeller) {
    return { label: "Dados completos", tone: "success" as const };
  }

  if (item.dataAvailability === "catalog_without_public_offer") {
    return { label: "Catalogo sem oferta publica", tone: "warning" as const };
  }

  if (hasTitle && hasImage && (hasCategory || item.attributes?.length)) {
    return { label: "Dados parciais", tone: "muted" as const };
  }

  return { label: "Poucos dados", tone: "muted" as const };
}

function mercadoLivreIncompleteNotice(item: MercadoLivreSearchItem) {
  if (item.dataAvailabilityMessage?.trim()) return item.dataAvailabilityMessage;

  if (item.dataAvailability === "catalog_without_public_offer") {
    return "Este resultado veio do Catalogo Mercado Livre, mas a API oficial nao retornou uma oferta publica vencedora para completar preco, vendedor e anuncio.";
  }

  if (item.source === "MERCADO_LIVRE_PRODUCT_SEARCH" && item.catalogProductId && !item.externalItemId && typeof item.price !== "number") {
    return "Produto de catalogo localizado. A API oficial ainda nao retornou uma oferta publica para este resultado.";
  }

  return "Alguns dados de oferta nao foram retornados pela API do Mercado Livre para este resultado.";
}

function isUsefulMercadoLivreCard(item: MercadoLivreSearchItem) {
  return mercadoLivreDataCompleteness(item).label === "Dados completos";
}

function isMercadoLivreCatalogWithoutPublicOffer(item: MercadoLivreSearchItem) {
  return item.dataAvailability === "catalog_without_public_offer";
}

function hasMercadoLivrePublicOffer(item: MercadoLivreSearchItem) {
  if (isMercadoLivreCatalogWithoutPublicOffer(item)) return false;
  return Boolean(
    item.externalItemId ||
      item.dataAvailability === "complete" ||
      item.dataAvailability === "catalog_offer" ||
      typeof item.price === "number" ||
      item.sellerId ||
      item.sellerName
  );
}

function mercadoLivreResultMatchesLocalFilters(
  item: MercadoLivreSearchItem,
  compatibility: ProductSuggestionCompatibilityResult | null,
  filters: Set<MercadoLivreLocalFilter>
) {
  const dataCompleteness = mercadoLivreDataCompleteness(item);
  const listingType = mercadoLivreListingTypeLabel(item);

  if (!hasMercadoLivrePublicOffer(item)) return false;
  if (!filters.size) return true;

  if (filters.has("hideIncomplete") && !isUsefulMercadoLivreCard(item)) return false;
  if (filters.has("completeData") && dataCompleteness.label !== "Dados completos") return false;
  if (filters.has("withPrice") && typeof item.price !== "number") return false;
  if (filters.has("withSeller") && !mercadoLivreSellerLabel(item)) return false;
  if (filters.has("hideLowCompatibility") && compatibility?.level === "LOW") return false;
  if (filters.has("classic") && listingType !== "Clássico" && listingType !== "Classico") return false;
  if (filters.has("premium") && listingType !== "Premium") return false;

  return true;
}

export function IntelligentProductRegistrationPage() {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Busque pelo SKU, GTIN ou titulo. O W Ecommerce consulta o Product local e o banco GTIN interno antes de qualquer fonte futura.");
  const [selectedProduct, setSelectedProduct] = useState<SafeProduct | null>(null);
  const [selectedProductSku, setSelectedProductSku] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [selectedProductGtin, setSelectedProductGtin] = useState<string | null>(null);
  const [selectedProductBrand, setSelectedProductBrand] = useState<string | null>(null);
  const [amazonGtinInput, setAmazonGtinInput] = useState("");
  const [amazonCatalogState, setAmazonCatalogState] = useState<AmazonCatalogState>("idle");
  const [amazonCatalogItems, setAmazonCatalogItems] = useState<AmazonCatalogItem[]>([]);
  const [amazonCatalogMessage, setAmazonCatalogMessage] = useState<string | null>(null);
  const [selectedAmazonReference, setSelectedAmazonReference] = useState<AmazonCatalogItem | null>(null);
  const [amazonDraft, setAmazonDraft] = useState<AmazonReferenceDraft>(() => createAmazonReferenceDraft());
  const [amazonDraftReviewOpen, setAmazonDraftReviewOpen] = useState(false);
  const [, setMercadoLivreLoading] = useState(true);
  const [mercadoLivreConfigured, setMercadoLivreConfigured] = useState(false);
  const [mercadoLivreAccounts, setMercadoLivreAccounts] = useState<MercadoLivreAccount[]>([]);
  const [mercadoLivreSearchLoading, setMercadoLivreSearchLoading] = useState(false);
  const [mercadoLivreSearch, setMercadoLivreSearch] = useState<MercadoLivreSearchResponse | null>(null);
  const [mercadoLivreSearchState, setMercadoLivreSearchState] = useState<MercadoLivreSearchState>("idle");
  const [mercadoLivreStatusMessage, setMercadoLivreStatusMessage] = useState<string | null>(null);
  const [mercadoLivreLastQuery, setMercadoLivreLastQuery] = useState<string | null>(null);
  const [mercadoLivreLastSearchMode, setMercadoLivreLastSearchMode] = useState<MercadoLivreSearchMode | null>(null);
  const [mercadoLivreHttpStatus, setMercadoLivreHttpStatus] = useState<number | null>(null);
  const [mercadoLivreItemsCount, setMercadoLivreItemsCount] = useState<number | null>(null);
  const [mercadoLivreGtinStatus, setMercadoLivreGtinStatus] = useState<MercadoLivreSearchState>("idle");
  const [mercadoLivreTitleStatus, setMercadoLivreTitleStatus] = useState<MercadoLivreSearchState>("idle");
  const [internalGtinChecked, setInternalGtinChecked] = useState(false);
  const [internalGtinState, setInternalGtinState] = useState<InternalGtinState>("idle");
  const [internalGtinLoading, setInternalGtinLoading] = useState(false);
  const [internalGtinCatalog, setInternalGtinCatalog] = useState<SafeGtinCatalog | null>(null);
  const [internalGtinStatusMessage, setInternalGtinStatusMessage] = useState<string | null>(null);
  const [internalGtinDiagnostic, setInternalGtinDiagnostic] = useState<InternalGtinDiagnostic | null>(null);
  const [mercadoLivrePageSize, setMercadoLivrePageSize] = useState(10);
  const [mercadoLivreOfferPage, setMercadoLivreOfferPage] = useState(1);
  const [mercadoLivreOfferCollecting, setMercadoLivreOfferCollecting] = useState(false);
  const [mercadoLivreOfferCollectionError, setMercadoLivreOfferCollectionError] = useState<string | null>(null);
  const [mercadoLivreLocalFilters, setMercadoLivreLocalFilters] = useState<Set<MercadoLivreLocalFilter>>(defaultMercadoLivreLocalFilters);
  const [mercadoLivreFiltersOpen, setMercadoLivreFiltersOpen] = useState(false);
  const mercadoLivreFiltersRef = useRef<HTMLDivElement>(null);
  const [referenceImportOpen, setReferenceImportOpen] = useState(false);
  const [referenceImportInput, setReferenceImportInput] = useState("");
  const [referenceImportLoading, setReferenceImportLoading] = useState(false);
  const [referenceImportError, setReferenceImportError] = useState<string | null>(null);
  const [referenceImportErrorDetails, setReferenceImportErrorDetails] = useState<MercadoLivreReferenceImportResponse | null>(null);
  const [referenceImport, setReferenceImport] = useState<MercadoLivreReferenceImport | null>(null);
  const [selectedReferenceFields, setSelectedReferenceFields] = useState<Set<string>>(new Set());
  const [selectedMercadoLivreResultKey, setSelectedMercadoLivreResultKey] = useState<string | null>(null);
  const [mercadoLivreDetailLoadingKey, setMercadoLivreDetailLoadingKey] = useState<string | null>(null);
  const [mercadoLivreDetailError, setMercadoLivreDetailError] = useState<{ key: string; message: string } | null>(null);
  const [enrichedMercadoLivreItemsById, setEnrichedMercadoLivreItemsById] = useState<Record<string, MercadoLivreSearchItem>>({});
  const [loadingMercadoLivreDetailsById, setLoadingMercadoLivreDetailsById] = useState<Record<string, boolean>>({});
  const [mercadoLivreDetailErrorsById, setMercadoLivreDetailErrorsById] = useState<Record<string, string>>({});
  const [mercadoLivreDetailCompletedById, setMercadoLivreDetailCompletedById] = useState<Record<string, boolean>>({});
  const [selectedMercadoLivreSuggestion, setSelectedMercadoLivreSuggestion] = useState<MercadoLivreSearchItem | null>(null);
  const [selectedMercadoLivreFields, setSelectedMercadoLivreFields] = useState<Set<string>>(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [enrichmentHistory, setEnrichmentHistory] = useState<ProductEnrichmentHistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<ProductEnrichmentHistoryItem | null>(null);
  const [activePanel, setActivePanel] = useState<AuxiliaryPanel>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewBrand, setPreviewBrand] = useState("");
  const [previewBrandVisible, setPreviewBrandVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewSelectedIndex, setPreviewSelectedIndex] = useState(0);
  const saveInFlightRef = useRef(false);
  const mercadoLivreDetailRequestsRef = useRef<Set<string>>(new Set());
  const mercadoLivreLoadedRawPagesRef = useRef<Set<number>>(new Set());

  const product = selectedProduct;
  const selectedAmazonReferenceAsin = selectedAmazonReference?.asin ?? null;
  const lookupGtinCatalog = lookup?.gtinCatalog ?? null;
  const gtinCatalog = internalGtinCatalog ?? lookupGtinCatalog;
  const suggestions = lookup?.fieldSuggestions ?? [];
  const mercadoLivreAccount = mercadoLivreAccounts.find((account) => account.status === "ACTIVE") ?? null;
  const mercadoLivreConnected = Boolean(mercadoLivreAccount);
  const mercadoLivreSearchUnavailable = isMercadoLivreSearchUnavailable(mercadoLivreSearch);
  const mercadoLivreNotice = mercadoLivrePrimaryNotice(mercadoLivreSearch);
  const mercadoLivreGtinCatalogEmpty = isMercadoLivreGtinCatalogEmpty(mercadoLivreSearch);
  const mercadoLivreEffectiveSearchType = effectiveMercadoLivreSearchType(mercadoLivreSearch);
  const mercadoLivreEffectiveSearchValue = effectiveMercadoLivreSearchValue(mercadoLivreSearch);
  const mercadoLivreManualSearchUrl = mercadoLivrePublicSearchUrl(mercadoLivreEffectiveSearchValue);
  const mercadoLivreCopyGtinValue = mercadoLivreSearch?.localProduct?.gtin || (mercadoLivreEffectiveSearchType === "GTIN" ? mercadoLivreEffectiveSearchValue : null);
  const mercadoLivreGtinManualSearchUrl = mercadoLivrePublicSearchUrl(mercadoLivreCopyGtinValue);
  const mercadoLivreGtinSearchBlocked =
    mercadoLivreSearch?.apiSearchStatus === "blocked" &&
    (mercadoLivreSearch.firstSearchType === "GTIN" || mercadoLivreSearch.searchType === "GTIN") &&
    Boolean(mercadoLivreCopyGtinValue);
  const mercadoLivreCopyTitleValue = mercadoLivreSearch?.localProduct?.name || (mercadoLivreEffectiveSearchType === "TITLE" ? mercadoLivreEffectiveSearchValue : query.trim() || null);
  const mercadoLivrePaging = mercadoLivreSearch?.paging ?? null;
  const mercadoLivrePageStart = mercadoLivrePaging && mercadoLivreSearch?.items.length ? mercadoLivrePaging.offset + 1 : 0;
  const mercadoLivrePageEnd = mercadoLivrePaging && mercadoLivreSearch?.items.length ? mercadoLivrePaging.offset + mercadoLivreSearch.items.length : 0;
  const rankedMercadoLivreItems = useMemo(() => {
    if (!mercadoLivreSearch?.items.length) return [];

    return mercadoLivreSearch.items
      .map((item, originalIndex) => {
        const detailKey = mercadoLivreDetailCacheKey(item);
        const mergedItem = detailKey && enrichedMercadoLivreItemsById[detailKey]
          ? mergeMercadoLivreDetailForUi(item, enrichedMercadoLivreItemsById[detailKey])
          : item;
        const compatibility = product
          ? calculateProductSuggestionCompatibility(product, mercadoLivreItemToCompatibilitySuggestion(mergedItem))
          : null;

        return { item: mergedItem, compatibility, originalIndex };
      })
      .sort((left, right) => {
        const leftUseful = isUsefulMercadoLivreCard(left.item) ? 1 : 0;
        const rightUseful = isUsefulMercadoLivreCard(right.item) ? 1 : 0;
        if (rightUseful !== leftUseful) return rightUseful - leftUseful;

        const leftScore = left.compatibility?.score ?? -1;
        const rightScore = right.compatibility?.score ?? -1;
        if (rightScore !== leftScore) return rightScore - leftScore;

        const leftGtinMatch = left.compatibility?.gtin.match === true ? 1 : 0;
        const rightGtinMatch = right.compatibility?.gtin.match === true ? 1 : 0;
        if (rightGtinMatch !== leftGtinMatch) return rightGtinMatch - leftGtinMatch;

        const leftBrandMatch = left.compatibility?.brand.match === true ? 1 : 0;
        const rightBrandMatch = right.compatibility?.brand.match === true ? 1 : 0;
        if (rightBrandMatch !== leftBrandMatch) return rightBrandMatch - leftBrandMatch;

        const leftMatchedWords = left.compatibility?.matchedWords.length ?? 0;
        const rightMatchedWords = right.compatibility?.matchedWords.length ?? 0;
        if (rightMatchedWords !== leftMatchedWords) return rightMatchedWords - leftMatchedWords;

        return left.originalIndex - right.originalIndex;
      });
  }, [enrichedMercadoLivreItemsById, mercadoLivreSearch?.items, product]);
  const mercadoLivreOfferItems = useMemo(
    () =>
      rankedMercadoLivreItems
        .map((entry, rankedIndex) => ({ ...entry, rankedIndex }))
        .filter(({ item }) => hasMercadoLivrePublicOffer(item)),
    [rankedMercadoLivreItems]
  );
  const mercadoLivreOfferPageStartIndex = (mercadoLivreOfferPage - 1) * mercadoLivrePageSize;
  const mercadoLivreOfferPageItems = useMemo(
    () => mercadoLivreOfferItems.slice(mercadoLivreOfferPageStartIndex, mercadoLivreOfferPageStartIndex + mercadoLivrePageSize),
    [mercadoLivreOfferItems, mercadoLivreOfferPageStartIndex, mercadoLivrePageSize]
  );
  const filteredMercadoLivreItems = useMemo(
    () => mercadoLivreOfferPageItems.filter(({ item, compatibility }) => mercadoLivreResultMatchesLocalFilters(item, compatibility, mercadoLivreLocalFilters)),
    [mercadoLivreLocalFilters, mercadoLivreOfferPageItems]
  );
  const mercadoLivreHideIncompleteActive = mercadoLivreLocalFilters.has("hideIncomplete");
  const mercadoLivreActiveFilterCount = mercadoLivreLocalFilters.size;
  const mercadoLivreUsefulResultCount = rankedMercadoLivreItems.filter(({ item }) => isUsefulMercadoLivreCard(item)).length;
  const mercadoLivreHiddenIncompleteCount = rankedMercadoLivreItems.filter(({ item }) => !isUsefulMercadoLivreCard(item)).length;
  const mercadoLivrePublicOfferResultCount = mercadoLivreOfferItems.length;
  const mercadoLivreLoadedCatalogCount = mercadoLivreSearch?.items.length ?? 0;
  const mercadoLivreTargetOfferCount = mercadoLivreOfferPage * mercadoLivrePageSize;
  const mercadoLivreCanAnalyzeMoreCatalogs = mercadoLivreLoadedCatalogCount < MERCADO_LIVRE_OFFER_PAGE_MAX_CATALOGS && Boolean(mercadoLivrePaging?.hasNextPage);
  const mercadoLivreOfferPageCanGoNext =
    mercadoLivrePublicOfferResultCount > mercadoLivreOfferPage * mercadoLivrePageSize || mercadoLivreCanAnalyzeMoreCatalogs || mercadoLivreOfferCollecting;
  const mercadoLivreOfferPageHasPrevious = mercadoLivreOfferPage > 1;
  const mercadoLivreCurrentPageDetailKeys = useMemo(
    () =>
      Array.from(
        new Set(
          (mercadoLivreSearch?.items ?? [])
            .map((item) => mercadoLivreDetailCacheKey(item))
            .filter((detailKey): detailKey is string => Boolean(detailKey))
        )
      ),
    [mercadoLivreSearch?.items]
  );
  const mercadoLivreCurrentPageDetailSignature = mercadoLivreCurrentPageDetailKeys.join("|");
  const mercadoLivreCurrentPageDetailsTotal = mercadoLivreCurrentPageDetailKeys.length;
  const mercadoLivreCurrentPageDetailsLoaded = mercadoLivreCurrentPageDetailKeys.filter((detailKey) => {
    return Boolean(
      mercadoLivreDetailCompletedById[detailKey] ||
      enrichedMercadoLivreItemsById[detailKey] ||
      mercadoLivreDetailErrorsById[detailKey]
    );
  }).length;
  const mercadoLivreCurrentPageDetailsLoading = mercadoLivreCurrentPageDetailKeys.filter((detailKey) => Boolean(loadingMercadoLivreDetailsById[detailKey])).length;
  const mercadoLivreCurrentPageDetailsFailed = mercadoLivreCurrentPageDetailKeys.filter((detailKey) => Boolean(mercadoLivreDetailErrorsById[detailKey])).length;
  const mercadoLivreCurrentPageDetailsFinished = mercadoLivreCurrentPageDetailsLoaded;
  const mercadoLivreCurrentPageDetailsPending = Math.max(0, mercadoLivreCurrentPageDetailsTotal - mercadoLivreCurrentPageDetailsFinished - mercadoLivreCurrentPageDetailsLoading);
  const mercadoLivreCurrentPageDetailsInProgress =
    mercadoLivreCurrentPageDetailsTotal > 0 && mercadoLivreCurrentPageDetailsFinished < mercadoLivreCurrentPageDetailsTotal;
  const mercadoLivreAnalyzedResultCount = mercadoLivreCurrentPageDetailsFinished;
  const mercadoLivreNeedsMoreOffersForPage =
    Boolean(mercadoLivreSearch) &&
    mercadoLivreSearchState !== "blocked_403" &&
    mercadoLivreSearchState !== "error" &&
    mercadoLivrePublicOfferResultCount < mercadoLivreTargetOfferCount &&
    mercadoLivreCanAnalyzeMoreCatalogs;
  const mercadoLivreOfferCollectionInProgress =
    Boolean(mercadoLivreSearch) && (mercadoLivreOfferCollecting || mercadoLivreCurrentPageDetailsInProgress || mercadoLivreNeedsMoreOffersForPage);
  const mercadoLivreOfferPageIncompleteFinal =
    Boolean(mercadoLivreSearch) &&
    !mercadoLivreOfferCollectionInProgress &&
    mercadoLivreOfferPageItems.length > 0 &&
    mercadoLivreOfferPageItems.length < mercadoLivrePageSize &&
    !mercadoLivreOfferPageCanGoNext;
  const selectedMercadoLivreResult =
    filteredMercadoLivreItems.find(({ item, rankedIndex }) => mercadoLivreItemKey(item, rankedIndex) === selectedMercadoLivreResultKey) ??
    filteredMercadoLivreItems[0] ??
    null;
  const selectedMercadoLivreResultKeyForRender = selectedMercadoLivreResult
    ? mercadoLivreItemKey(selectedMercadoLivreResult.item, selectedMercadoLivreResult.rankedIndex)
    : null;
  const selectedMercadoLivreResultCompatibility = selectedMercadoLivreResult?.compatibility ?? null;
  const selectedMercadoLivreDetailItem = selectedMercadoLivreResult?.item ?? null;
  const selectedMercadoLivreDetailCacheKey = selectedMercadoLivreDetailItem ? mercadoLivreDetailCacheKey(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailLoading =
    Boolean(selectedMercadoLivreDetailCacheKey && loadingMercadoLivreDetailsById[selectedMercadoLivreDetailCacheKey]) ||
    Boolean(selectedMercadoLivreResultKeyForRender && mercadoLivreDetailLoadingKey === selectedMercadoLivreResultKeyForRender);
  const selectedMercadoLivreDetailError =
    selectedMercadoLivreDetailCacheKey && mercadoLivreDetailErrorsById[selectedMercadoLivreDetailCacheKey]
      ? mercadoLivreDetailErrorsById[selectedMercadoLivreDetailCacheKey]
      : selectedMercadoLivreResultKeyForRender && mercadoLivreDetailError?.key === selectedMercadoLivreResultKeyForRender
        ? mercadoLivreDetailError.message
        : null;
  const selectedMercadoLivreDetailAttributes =
    selectedMercadoLivreDetailItem?.attributes?.filter((attribute) => (attribute.id || attribute.name) && attribute.value).slice(0, 12) ?? [];
  const selectedMercadoLivreDetailSeller = selectedMercadoLivreDetailItem ? mercadoLivreSellerLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailReputation = selectedMercadoLivreDetailItem ? mercadoLivreReputationLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailSales = selectedMercadoLivreDetailItem ? mercadoLivreSalesLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailLocation = selectedMercadoLivreDetailItem ? mercadoLivreLocationLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailCondition = selectedMercadoLivreDetailItem ? mercadoLivreConditionLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailListingType = selectedMercadoLivreDetailItem ? mercadoLivreListingTypeLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailCategory = selectedMercadoLivreDetailItem ? mercadoLivreCategoryLabel(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDetailUrl = selectedMercadoLivreDetailItem ? mercadoLivreItemPublicUrl(selectedMercadoLivreDetailItem) : null;
  const selectedMercadoLivreDataCompleteness = selectedMercadoLivreDetailItem ? mercadoLivreDataCompleteness(selectedMercadoLivreDetailItem) : null;
  useEffect(() => {
    if (!filteredMercadoLivreItems.length) {
      if (selectedMercadoLivreResultKey) setSelectedMercadoLivreResultKey(null);
      return;
    }

    const selectedStillExists = filteredMercadoLivreItems.some(({ item, rankedIndex }) => mercadoLivreItemKey(item, rankedIndex) === selectedMercadoLivreResultKey);
    if (!selectedStillExists) {
      setSelectedMercadoLivreResultKey(mercadoLivreItemKey(filteredMercadoLivreItems[0].item, filteredMercadoLivreItems[0].rankedIndex));
    }
  }, [filteredMercadoLivreItems, selectedMercadoLivreResultKey]);

  useEffect(() => {
    if (!mercadoLivreFiltersOpen) return;

    function closeFilters(event: MouseEvent) {
      if (!mercadoLivreFiltersRef.current?.contains(event.target as Node)) {
        setMercadoLivreFiltersOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMercadoLivreFiltersOpen(false);
    }

    document.addEventListener("mousedown", closeFilters);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeFilters);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mercadoLivreFiltersOpen]);

  const referenceReviewRows = referenceImport
    ? [
        { field: "name", label: "Titulo", current: product?.name ?? null, suggested: referenceImport.title, origin: "Anuncio ML", selectable: Boolean(referenceImport.title) },
        { field: "description", label: "Descricao", current: product?.description ?? null, suggested: referenceImport.description, origin: "Descricao ML", selectable: Boolean(referenceImport.description) },
        { field: "brand", label: "Marca", current: product?.brand ?? null, suggested: referenceImport.brand, origin: "Atributos ML", selectable: Boolean(referenceImport.brand) },
        { field: "ean", label: "GTIN", current: product?.gtin ?? null, suggested: referenceImport.gtin, origin: "Atributos ML", selectable: Boolean(referenceImport.gtin) },
        { field: "partNumber", label: "Part number", current: null, suggested: referenceImport.partNumber, origin: "Atributos ML", selectable: false, note: "Guardado no draft ML; aplicacao em campo proprio vira etapa futura." },
        {
          field: "mercadoLivreCategory",
          label: "Categoria ML",
          current: product?.mercadoLivre?.marketplaceCategoryPath ?? product?.mercadoLivre?.marketplaceCategoryId ?? null,
          suggested: referenceImport.categoryName ?? referenceImport.categoryId,
          origin: "Categoria ML",
          selectable: Boolean(referenceImport.categoryName || referenceImport.categoryId),
          note: "Salva como sugestao local Mercado Livre. Nada e publicado."
        },
        { field: "imageUrl", label: "Imagem principal", current: product?.imageUrl ?? null, suggested: referenceImport.thumbnail, origin: "Imagem ML", selectable: Boolean(referenceImport.thumbnail) },
        { field: "additionalImageUrls", label: "Imagens adicionais", current: null, suggested: Array.isArray(referenceImport.pictures) ? `${referenceImport.pictures.length} imagens` : null, origin: "Imagens ML", selectable: Array.isArray(referenceImport.pictures) && referenceImport.pictures.length > 0, note: "Salva URLs adicionais na galeria local do produto." }
      ]
    : [];
  const mercadoLivreSuggestionReviewRows = selectedMercadoLivreSuggestion
    ? [
        { field: "name", label: "Titulo", current: product?.name ?? null, suggested: selectedMercadoLivreSuggestion.title, origin: mercadoLivreSourceLabel(selectedMercadoLivreSuggestion.source), selectable: Boolean(selectedMercadoLivreSuggestion.title) },
        { field: "description", label: "Descricao", current: product?.description ?? null, suggested: selectedMercadoLivreSuggestion.description ?? null, origin: mercadoLivreSourceLabel(selectedMercadoLivreSuggestion.source), selectable: Boolean(selectedMercadoLivreSuggestion.description) },
        { field: "brand", label: "Marca", current: product?.brand ?? null, suggested: selectedMercadoLivreSuggestion.brand, origin: "Atributos ML", selectable: Boolean(selectedMercadoLivreSuggestion.brand) },
        { field: "ean", label: "GTIN", current: product?.gtin ?? null, suggested: selectedMercadoLivreSuggestion.gtin, origin: "Atributos ML", selectable: Boolean(selectedMercadoLivreSuggestion.gtin) },
        { field: "imageUrl", label: "Imagem principal", current: product?.imageUrl ?? null, suggested: selectedMercadoLivreSuggestion.imageUrl, origin: "Imagem ML", selectable: Boolean(selectedMercadoLivreSuggestion.imageUrl) },
        {
          field: "mercadoLivreCategory",
          label: "Categoria ML",
          current: product?.mercadoLivre?.marketplaceCategoryPath ?? product?.mercadoLivre?.marketplaceCategoryId ?? null,
          suggested: selectedMercadoLivreSuggestion.categoryName ?? selectedMercadoLivreSuggestion.categoryId,
          origin: "Categoria ML",
          selectable: Boolean(selectedMercadoLivreSuggestion.categoryName || selectedMercadoLivreSuggestion.categoryId),
          note: "Salva como sugestao local Mercado Livre. Confirmacao oficial/publicacao ficam em fluxo futuro."
        },
        {
          field: "additionalImageUrls",
          label: "Imagens adicionais",
          current: null,
          suggested: selectedMercadoLivreSuggestion.imageUrls?.length ? `${selectedMercadoLivreSuggestion.imageUrls.length} imagem(ns)` : null,
          origin: "Imagens ML",
          selectable: Boolean(selectedMercadoLivreSuggestion.imageUrls?.length),
          note: "Salva URLs adicionais na galeria local do produto."
        },
        {
          field: "priceReference",
          label: "Preco de referencia",
          current: product?.price ?? null,
          suggested: selectedMercadoLivreSuggestion.price === null ? null : formatCurrency(selectedMercadoLivreSuggestion.price),
          origin: "Preco ML",
          selectable: false,
          note: "Preco nao e alterado no Cadastro Inteligente."
        },
        {
          field: "mercadoLivreAttributes",
          label: "Atributos",
          current: null,
          suggested: selectedMercadoLivreSuggestion.attributes?.length ? `${selectedMercadoLivreSuggestion.attributes.length} atributo(s)` : null,
          origin: "Atributos ML",
          selectable: Boolean(selectedMercadoLivreSuggestion.attributes?.length && (selectedMercadoLivreSuggestion.categoryId || product?.mercadoLivre?.marketplaceCategoryId)),
          note: "Salva atributos como sugestoes locais para revisao. Nada e enviado ao Mercado Livre."
        }
      ]
    : [];

  const amazonDraftBase = createAmazonReferenceDraft(product);
  const amazonDraftFieldsSelectedElsewhere = AMAZON_DRAFT_FIELDS.filter((field) => {
    if (field !== "name" && field !== "brand") return false;
    return selectedFields.has(field) || selectedReferenceFields.has(field) || selectedMercadoLivreFields.has(field);
  });
  const amazonReferenceReviewRows = selectedAmazonReference
    ? AMAZON_DRAFT_FIELDS.map((field) => {
        const selectedElsewhereValue =
          field === "name" || field === "brand"
            ? [
                mercadoLivreSuggestionReviewRows.find((row) => row.field === field && selectedMercadoLivreFields.has(field))?.suggested,
                referenceReviewRows.find((row) => row.field === field && selectedReferenceFields.has(field))?.suggested,
                suggestions.find((row) => row.field === field && selectedFields.has(field))?.suggestedValue
              ].find((value) => typeof value === "string" && value.trim())
            : undefined;
        const current = typeof selectedElsewhereValue === "string" ? selectedElsewhereValue : amazonDraftBase.values[field];
        const suggested = amazonReferenceSuggestion(selectedAmazonReference, field);
        return {
          field,
          label: amazonDraftFieldLabels[field],
          current,
          suggested,
          applied: amazonDraft.appliedFields.includes(field),
          kept: amazonDraft.keptFields.includes(field),
          hasSuggestion: amazonDraftValueHasContent(suggested),
          matchesCurrent:
            amazonDraftValueHasContent(current) &&
            amazonDraftValueHasContent(suggested) &&
            amazonDraftValuesEqual(current, suggested),
          conflict:
            amazonDraftValueHasContent(current) &&
            amazonDraftValueHasContent(suggested) &&
            !amazonDraftValuesEqual(current, suggested),
          persistsWithExistingSave: field === "name" || field === "brand"
        };
      })
    : [];
  const amazonReferenceHasConflicts = amazonReferenceReviewRows.some((row) => row.conflict);

  function resetAmazonReferenceState(nextProduct: SafeProduct | null) {
    setSelectedAmazonReference(null);
    setAmazonDraft(createAmazonReferenceDraft(nextProduct));
    setAmazonDraftReviewOpen(false);
  }

  async function searchAmazonCatalog() {
    const gtin = amazonGtinInput.trim();
    const fallbackTitle = selectedProductName?.trim() || query.trim();
    if (!gtin && !fallbackTitle) {
      setAmazonCatalogState("error");
      setAmazonCatalogItems([]);
      setAmazonCatalogMessage("Selecione um produto com GTIN ou titulo para buscar uma referencia.");
      return;
    }

    resetAmazonReferenceState(product);
    setAmazonCatalogState("loading");
    setAmazonCatalogItems([]);
    setAmazonCatalogMessage("Buscando referencia na Amazon...");

    const params = new URLSearchParams();
    if (gtin) params.set("gtin", gtin);
    else params.set("title", fallbackTitle);
    if (selectedProductSku) params.set("sku", selectedProductSku);

    try {
      const response = await fetch(`/api/integrations/amazon/catalog/search?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as AmazonCatalogResponse | null;

      if (!response.ok || !payload?.success) {
        const unavailable = response.status === 409;
        setAmazonCatalogState(unavailable ? "unavailable" : "error");
        setAmazonCatalogMessage(
          unavailable
            ? "A conexao Amazon ainda nao esta disponivel."
            : response.status === 400
              ? payload?.error ?? "Confira o GTIN informado e tente novamente."
              : "Nao foi possivel consultar a Amazon agora."
        );
        return;
      }

      const items = payload.data?.items ?? [];
      setAmazonCatalogItems(items);
      if (!items.length) {
        setAmazonCatalogState("empty");
        setAmazonCatalogMessage(
          gtin
            ? "Nenhuma referencia encontrada na Amazon para este GTIN."
            : "Nenhuma referencia encontrada na Amazon para este titulo."
        );
        return;
      }

      setAmazonCatalogState("success");
      setAmazonCatalogMessage(`${items.length} referencia(s) encontrada(s) para revisao.`);
    } catch {
      setAmazonCatalogState("error");
      setAmazonCatalogItems([]);
      setAmazonCatalogMessage("Nao foi possivel consultar a Amazon agora.");
    }
  }

  function selectAmazonReference(item: AmazonCatalogItem) {
    setSelectedAmazonReference(item);
    setAmazonDraft(createAmazonReferenceDraft(product));
    setAmazonDraftReviewOpen(false);
    setAmazonCatalogMessage("Referência Amazon selecionada.");
    setMessage("Referência Amazon selecionada. As alterações ainda não foram salvas.");
    openProductPreview({
      title: item.title,
      brand: item.brand,
      images: item.imageUrl ? [item.imageUrl] : []
    });
  }

  function openAmazonDraftReview() {
    if (!selectedAmazonReference) return;
    setAmazonDraftReviewOpen(true);
    setAmazonCatalogMessage(
      amazonReferenceHasConflicts
        ? "Alguns campos já possuem informações. Escolha quais sugestões deseja usar."
        : "Compare as informações antes de aplicar."
    );
    setMessage("Compare as informações antes de aplicar. As alterações ainda não foram salvas.");
  }

  function applyAmazonSuggestionToDraft(field: AmazonDraftField) {
    if (!selectedAmazonReference) return;
    setAmazonDraft((current) => applyAmazonReferenceSuggestion(current, selectedAmazonReference, field));
    setAmazonCatalogMessage("Sugestão aplicada somente ao rascunho.");
    setMessage("As alterações ainda não foram salvas.");
  }

  function keepAmazonCurrentValue(field: AmazonDraftField) {
    setAmazonDraft((current) => keepAmazonDraftCurrentValue(current, product, field));
    setAmazonCatalogMessage("Valor atual mantido no rascunho.");
    setMessage("As alterações ainda não foram salvas.");
  }

  function applyAmazonOnlyToEmptyFields() {
    if (!selectedAmazonReference) return;
    const result = applyAmazonReferenceToEmptyFields(
      amazonDraft,
      selectedAmazonReference,
      amazonDraftFieldsSelectedElsewhere
    );
    setAmazonDraft(result.draft);
    setAmazonCatalogMessage(
      result.appliedFields.length
        ? "Sugestões aplicadas somente aos campos vazios."
        : "Nenhum campo vazio possui uma sugestão nova."
    );
    setMessage("As alterações ainda não foram salvas.");
  }

  async function loadMercadoLivreAccounts(options?: { silent?: boolean }) {
    if (!options?.silent) setMercadoLivreLoading(true);
    try {
      const response = await fetch("/api/marketplaces/mercado-livre/accounts", { cache: "no-store" });
      if (!response.ok) {
        setMercadoLivreConfigured(false);
        setMercadoLivreAccounts([]);
        return;
      }

      const payload = (await response.json()) as MercadoLivreAccountsResponse;
      setMercadoLivreConfigured(Boolean(payload.configured));
      setMercadoLivreAccounts(payload.accounts ?? []);
    } catch {
      setMercadoLivreConfigured(false);
      setMercadoLivreAccounts([]);
    } finally {
      if (!options?.silent) setMercadoLivreLoading(false);
    }
  }

  useEffect(() => {
    let canceled = false;

    async function loadInitialMercadoLivreData() {
      setMercadoLivreLoading(true);
      try {
        if (!canceled) {
          await loadMercadoLivreAccounts({ silent: true });
        }
      } catch {
        if (!canceled) {
          setMercadoLivreConfigured(false);
          setMercadoLivreAccounts([]);
        }
      } finally {
        if (!canceled) setMercadoLivreLoading(false);
      }
    }

    loadInitialMercadoLivreData();
    return () => {
      canceled = true;
    };
  }, []);

  function connectMercadoLivre() {
    window.location.href = "/api/marketplaces/mercado-livre/connect";
  }

  async function loadEnrichmentHistory(productId: string | null | undefined) {
    if (!productId) {
      setEnrichmentHistory([]);
      setSelectedHistory(null);
      return;
    }

    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/products/intelligent-registration/history?productId=${encodeURIComponent(productId)}&take=12`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as ProductEnrichmentHistoryResponse;
      if (!response.ok) {
        setEnrichmentHistory([]);
        setSelectedHistory(null);
        return;
      }
      setEnrichmentHistory(payload.items ?? []);
      setSelectedHistory((current) => (current && payload.items?.some((item) => item.id === current.id) ? current : null));
    } catch {
      setEnrichmentHistory([]);
      setSelectedHistory(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function copyText(value: string | null | undefined, label: string) {
    if (!value) {
      setMessage(`${label} nao disponivel para copiar.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado. Nenhum dado foi salvo ou enviado.`);
    } catch {
      setMessage(`Nao foi possivel copiar ${label.toLowerCase()}.`);
    }
  }

  function toggleMercadoLivreLocalFilter(filter: MercadoLivreLocalFilter) {
    setMercadoLivreLocalFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }

  function updateSelectedProductState(nextProduct: SafeProduct | null) {
    const nextGtin = normalizeGtinInput(nextProduct?.gtin);
    setSelectedProduct(nextProduct);
    setSelectedProductSku(nextProduct?.sku ?? null);
    setSelectedProductName(nextProduct?.name ?? null);
    setSelectedProductGtin(nextGtin || null);
    setSelectedProductBrand(nextProduct?.brand ?? null);
    setAmazonGtinInput(nextGtin);
    setAmazonCatalogState("idle");
    setAmazonCatalogItems([]);
    setAmazonCatalogMessage(null);
    resetAmazonReferenceState(nextProduct);
  }

  async function consultInternalGtinCatalog() {
    const productGtin = selectedProductGtin;
    const normalizedGtin = normalizeGtinInput(productGtin);
    const endpoint = "/api/gtin/search";

    setInternalGtinChecked(true);
    setInternalGtinLoading(false);
    setInternalGtinState("loading");
    setInternalGtinCatalog(null);
    setInternalGtinStatusMessage(null);
    setInternalGtinDiagnostic({
      selectedProductSku,
      selectedProductGtin,
      productGtin,
      normalizedGtin: normalizedGtin || null,
      internalGtinLastQuery: normalizedGtin || null,
      internalGtinStatus: "loading",
      endpoint,
      foundCount: 0,
      foundId: null
    });

    if (!normalizedGtin) {
      const nextMessage = "Este produto nao possui GTIN/EAN cadastrado.";
      setInternalGtinState("error");
      setInternalGtinStatusMessage(nextMessage);
      setInternalGtinDiagnostic({
        selectedProductSku,
        selectedProductGtin,
        productGtin,
        normalizedGtin: null,
        internalGtinLastQuery: null,
        internalGtinStatus: "error",
        endpoint,
        foundCount: 0,
        foundId: null
      });
      return;
    }

    setInternalGtinLoading(true);

    try {
      const response = await fetch(`${endpoint}?gtin=${encodeURIComponent(normalizedGtin)}`, { cache: "no-store" });
      const payload = (await response.json()) as GtinSearchPayload;
      const foundCatalog = response.ok ? gtinSearchPayloadToSafeCatalog(payload) : null;
      const foundCount = foundCatalog ? 1 : 0;
      setInternalGtinDiagnostic({
        selectedProductSku,
        selectedProductGtin,
        productGtin,
        normalizedGtin,
        internalGtinLastQuery: normalizedGtin,
        internalGtinStatus: response.ok ? (foundCatalog ? "found" : "not_found") : "error",
        endpoint,
        foundCount,
        foundId: foundCatalog?.id ?? null
      });

      if (!response.ok) {
        const nextMessage = payload.message ?? payload.error ?? "Nao foi possivel consultar o GTIN interno.";
        setInternalGtinState("error");
        setInternalGtinStatusMessage(nextMessage);
        return;
      }

      if (foundCatalog) {
        setInternalGtinCatalog(foundCatalog);
        setInternalGtinState("found");
        setInternalGtinStatusMessage(`GTIN do produto identificado: ${normalizedGtin}. Registro encontrado no banco mestre GTIN.`);
        return;
      }

      const nextMessage = `GTIN do produto identificado: ${normalizedGtin}. Este GTIN ainda nao possui registro enriquecido no banco mestre GTIN do SaaS.`;
      setInternalGtinState("not_found");
      setInternalGtinStatusMessage(nextMessage);
    } catch {
      const nextMessage = "Erro ao consultar o GTIN interno.";
      setInternalGtinState("error");
      setInternalGtinStatusMessage(nextMessage);
      setInternalGtinDiagnostic({
        selectedProductSku,
        selectedProductGtin,
        productGtin,
        normalizedGtin,
        internalGtinLastQuery: normalizedGtin,
        internalGtinStatus: "error",
        endpoint,
        foundCount: 0,
        foundId: null
      });
    } finally {
      setInternalGtinLoading(false);
    }
  }

  async function search(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setMessage("Informe SKU interno, GTIN/EAN ou titulo para buscar.");
      return;
    }

    setLoading(true);
    updateSelectedProductState(null);
    setInternalGtinChecked(false);
    setInternalGtinState("idle");
    setInternalGtinLoading(false);
    setInternalGtinCatalog(null);
    setInternalGtinStatusMessage(null);
    setInternalGtinDiagnostic(null);
    setMercadoLivreSearch(null);
    setMercadoLivreSearchState("idle");
    setMercadoLivreStatusMessage(null);
    setMercadoLivreLastQuery(null);
    setMercadoLivreLastSearchMode(null);
    setMercadoLivreHttpStatus(null);
    setMercadoLivreItemsCount(null);
    setMercadoLivreGtinStatus("idle");
    setMercadoLivreTitleStatus("idle");
    setMercadoLivreOfferPage(1);
    setMercadoLivreOfferCollecting(false);
    setMercadoLivreOfferCollectionError(null);
    mercadoLivreLoadedRawPagesRef.current = new Set();
    setMercadoLivreLocalFilters(defaultMercadoLivreLocalFilters());
    setSelectedMercadoLivreResultKey(null);
    setMercadoLivreDetailLoadingKey(null);
    setMercadoLivreDetailError(null);
    setReferenceImport(null);
    setReferenceImportError(null);
    setReferenceImportErrorDetails(null);
    setSelectedReferenceFields(new Set());
    setSelectedMercadoLivreSuggestion(null);
    setSelectedMercadoLivreFields(new Set());
    setMessage("Consultando somente o produto local. Nenhuma consulta externa sera realizada.");
    setEnrichmentHistory([]);
    setSelectedHistory(null);

    try {
      const response = await fetch(`/api/products/intelligent-registration/lookup?query=${encodeURIComponent(normalizedQuery)}`);
      const payload = (await response.json()) as LookupResponse;
      if (!response.ok) {
        setLookup(null);
        updateSelectedProductState(null);
        setSelectedFields(new Set());
        setMessage(payload.error ?? "Nao foi possivel executar a busca local.");
        return;
      }

      setLookup(payload);
      updateSelectedProductState(payload.product ?? null);
      setSelectedFields(new Set(payload.fieldSuggestions.filter((field) => field.selectedByDefault).map((field) => field.field)));
      setMessage(localLookupMessage(payload));
      await loadEnrichmentHistory(payload.product?.productId);
    } catch {
      setLookup(null);
      updateSelectedProductState(null);
      setSelectedFields(new Set());
      setMessage("Erro ao consultar dados locais. Nenhuma acao externa foi executada.");
    } finally {
      setLoading(false);
    }
  }

  const searchMercadoLivreReadOnly = useCallback(async (searchMode: MercadoLivreSearchMode, options?: { page?: number; pageSize?: number }) => {
    if (!mercadoLivreConnected) {
      const nextMessage = "Conecte uma conta Mercado Livre antes de buscar sugestoes externas.";
      setMercadoLivreSearchState("error");
      setMercadoLivreStatusMessage(nextMessage);
      setMessage(nextMessage);
      return;
    }

    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(20, Math.max(1, options?.pageSize ?? mercadoLivrePageSize));
    const preserveCurrentResults = Boolean(options?.page && mercadoLivreSearch);
    const typedQuery = query.trim();
    let searchValue = "";

    if (preserveCurrentResults && mercadoLivreLastQuery && mercadoLivreLastSearchMode === searchMode) {
      searchValue = mercadoLivreLastQuery;
    } else if (searchMode === "gtin") {
      searchValue = selectedProductGtin || normalizeGtinInput(typedQuery);
    } else if (searchMode === "title") {
      searchValue = selectedProductName?.trim() || typedQuery;
    } else {
      searchValue = selectedProductGtin || selectedProductName?.trim() || typedQuery;
    }

    if (!searchValue) {
      const nextMessage =
        searchMode === "gtin"
          ? "Este produto nao possui GTIN/EAN cadastrado."
          : "Informe SKU interno, GTIN/EAN ou titulo antes de buscar no Mercado Livre.";
      setMercadoLivreSearchState("error");
      setMercadoLivreStatusMessage(nextMessage);
      setMercadoLivreLastQuery(null);
      setMercadoLivreLastSearchMode(searchMode);
      setMercadoLivreHttpStatus(null);
      setMercadoLivreItemsCount(null);
      if (searchMode === "gtin") setMercadoLivreGtinStatus("error");
      if (searchMode === "title") setMercadoLivreTitleStatus("error");
      return;
    }

    setMercadoLivreSearchLoading(true);
    setMercadoLivreSearchState("loading");
    if (searchMode === "gtin") setMercadoLivreGtinStatus("loading");
    if (searchMode === "title") setMercadoLivreTitleStatus("loading");
    setMercadoLivreLastQuery(searchValue);
    setMercadoLivreLastSearchMode(searchMode);
    setMercadoLivreHttpStatus(null);
    setMercadoLivreItemsCount(null);
    setMercadoLivreStatusMessage(
      searchMode === "gtin"
        ? `Buscando no Catalogo Mercado Livre por GTIN/EAN: ${searchValue}. Nenhuma escrita externa sera executada.`
        : searchMode === "title"
          ? `Buscando no Catalogo Mercado Livre por titulo: ${searchValue}. Nenhuma escrita externa sera executada.`
          : `Buscando no Catalogo Mercado Livre em modo automatico: ${searchValue}. Nenhuma escrita externa sera executada.`
    );
    if (!preserveCurrentResults) {
      setMercadoLivreSearch(null);
      setMercadoLivreLocalFilters(defaultMercadoLivreLocalFilters());
      setMercadoLivreOfferPage(1);
      setMercadoLivreOfferCollecting(false);
      setMercadoLivreOfferCollectionError(null);
      mercadoLivreLoadedRawPagesRef.current = new Set();
    }
    setSelectedMercadoLivreResultKey(null);
    setMercadoLivreDetailLoadingKey(null);
    setMercadoLivreDetailError(null);
    setReferenceImport(null);
    setSelectedReferenceFields(new Set());
    setSelectedMercadoLivreSuggestion(null);
    setSelectedMercadoLivreFields(new Set());
    try {
      const params = new URLSearchParams({
        q: searchValue,
        searchMode,
        page: String(page),
        pageSize: String(pageSize)
      });
      const response = await fetch(`/api/marketplaces/mercado-livre/search?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as MercadoLivreSearchResponse;
      const sanitizedHttpStatus = payload.mercadoLivreError?.httpStatus ?? response.status;
      setMercadoLivreHttpStatus(sanitizedHttpStatus);
      if (!response.ok) {
        const nextMessage = payload.error ?? "Nao foi possivel consultar o Mercado Livre em modo leitura.";
        const nextState = response.status === 403 ? "blocked_403" : "error";
        setMercadoLivreSearchState(nextState);
        if (searchMode === "gtin") setMercadoLivreGtinStatus(nextState);
        if (searchMode === "title") setMercadoLivreTitleStatus(nextState);
        setMercadoLivreStatusMessage(nextMessage);
        setMercadoLivreItemsCount(0);
        return;
      }

      setMercadoLivreSearch(payload);
      mercadoLivreLoadedRawPagesRef.current = new Set([payload.paging?.page ?? page]);
      const effectiveType = payload.effectiveSearchType ?? payload.searchType;
      const effectiveValue = effectiveMercadoLivreSearchValue(payload);
      const modeLabel = effectiveType === "GTIN" ? "GTIN" : "titulo";
      const warningText = mercadoLivrePrimaryNotice(payload);
      const unavailable = isMercadoLivreSearchUnavailable(payload);
      const itemCount = payload.items?.length ?? 0;
      setMercadoLivreItemsCount(itemCount);
      setMercadoLivreSearchState(
        unavailable
          ? "blocked_403"
          : itemCount > 0
            ? "success"
            : "empty"
      );
      const nextMercadoLivreState =
        unavailable
          ? "blocked_403"
          : itemCount > 0
            ? "success"
            : "empty";
      if (searchMode === "gtin") setMercadoLivreGtinStatus(nextMercadoLivreState);
      if (searchMode === "title") setMercadoLivreTitleStatus(nextMercadoLivreState);
      const totalText = payload.paging?.total !== null && payload.paging?.total !== undefined ? ` de ${payload.paging.total.toLocaleString("pt-BR")}` : "";
      const timingText =
        typeof payload.performance?.totalMs === "number"
          ? ` em ${(payload.performance.totalMs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}s`
          : "";
      const resultText = `${itemCount}${totalText} resultado(s)`;
      setMercadoLivreStatusMessage(
        payload.items?.length
          ? `Catalogo Mercado Livre retornou ${resultText}${timingText} por ${modeLabel}: ${effectiveValue}. Pagina ${payload.paging?.page ?? page}. A lista basica ja esta visivel; detalhes dos anuncios carregam progressivamente.`
          : unavailable
            ? effectiveType === "GTIN"
              ? "O Catalogo Mercado Livre recusou a consulta read-only por GTIN/EAN no momento. Tente buscar por titulo."
              : "O Catalogo Mercado Livre recusou a consulta read-only no momento. A busca local continua disponivel."
            : effectiveType === "GTIN"
              ? "Nenhum produto encontrado no Catálogo Mercado Livre para este GTIN/EAN. Você pode tentar buscar pelo título do produto."
              : effectiveValue
                ? `Catalogo Mercado Livre consultado por ${modeLabel}: ${effectiveValue}. Resultados sao apenas sugestoes externas.${warningText ? ` ${warningText}` : ""}`
                : `Mercado Livre nao foi consultado.${warningText ? ` ${warningText}` : ""}`
      );
    } catch {
      setMercadoLivreSearchState("error");
      if (searchMode === "gtin") setMercadoLivreGtinStatus("error");
      if (searchMode === "title") setMercadoLivreTitleStatus("error");
      setMercadoLivreStatusMessage("Erro ao consultar Mercado Livre. Nenhuma escrita externa foi executada.");
      setMercadoLivreHttpStatus(null);
      setMercadoLivreItemsCount(0);
    } finally {
      setMercadoLivreSearchLoading(false);
    }
  }, [
    mercadoLivreConnected,
    mercadoLivreLastQuery,
    mercadoLivreLastSearchMode,
    mercadoLivrePageSize,
    mercadoLivreSearch,
    query,
    selectedProductGtin,
    selectedProductName
  ]);

  const loadMoreMercadoLivreOfferCandidates = useCallback(async () => {
    if (!mercadoLivreSearch || mercadoLivreOfferCollecting) return;
    const currentPaging = mercadoLivreSearch.paging;
    const currentRawCount = mercadoLivreSearch.items.length;
    if (!currentPaging?.hasNextPage || currentRawCount >= MERCADO_LIVRE_OFFER_PAGE_MAX_CATALOGS) return;

    const nextRawPage = (currentPaging.page ?? 1) + 1;
    if (mercadoLivreLoadedRawPagesRef.current.has(nextRawPage)) return;

    const continuationValue = effectiveMercadoLivreSearchValue(mercadoLivreSearch) || mercadoLivreLastQuery || mercadoLivreSearch.query;
    if (!continuationValue) return;

    const continuationMode = mercadoLivreContinuationSearchMode(mercadoLivreSearch);
    const rawPageSize = Math.min(20, Math.max(1, currentPaging.pageSize ?? mercadoLivrePageSize));
    mercadoLivreLoadedRawPagesRef.current.add(nextRawPage);
    setMercadoLivreOfferCollecting(true);
    setMercadoLivreOfferCollectionError(null);
    setMercadoLivreStatusMessage(
      `Buscando anuncios com oferta. ${mercadoLivrePublicOfferResultCount} encontrado(s), ${mercadoLivreCurrentPageDetailsFinished} catalogo(s) analisado(s).`
    );

    try {
      const params = new URLSearchParams({
        q: continuationValue,
        searchMode: continuationMode,
        page: String(nextRawPage),
        pageSize: String(rawPageSize)
      });
      const response = await fetch(`/api/marketplaces/mercado-livre/search?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as MercadoLivreSearchResponse;

      if (!response.ok) {
        const nextMessage = payload.error ?? "Nao foi possivel buscar mais anuncios com oferta.";
        setMercadoLivreOfferCollectionError(nextMessage);
        return;
      }

      setMercadoLivreSearch((current) => {
        if (!current) return current;
        const mergedItems = mergeUniqueMercadoLivreSearchItems(current.items, payload.items ?? []).slice(0, MERCADO_LIVRE_OFFER_PAGE_MAX_CATALOGS);
        return {
          ...current,
          warnings: Array.from(new Set([...(current.warnings ?? []), ...(payload.warnings ?? [])])),
          endpointDiagnostics: [...(current.endpointDiagnostics ?? []), ...(payload.endpointDiagnostics ?? [])],
          paging: payload.paging ?? current.paging,
          performance: {
            ...current.performance,
            basicResultsCount: mergedItems.length
          },
          items: mergedItems
        };
      });
      setMercadoLivreItemsCount((current) => Math.max(current ?? 0, currentRawCount + (payload.items?.length ?? 0)));
    } catch {
      setMercadoLivreOfferCollectionError("Erro ao buscar mais anuncios com oferta.");
    } finally {
      setMercadoLivreOfferCollecting(false);
    }
  }, [
    mercadoLivreCurrentPageDetailsFinished,
    mercadoLivreLastQuery,
    mercadoLivreOfferCollecting,
    mercadoLivrePageSize,
    mercadoLivrePublicOfferResultCount,
    mercadoLivreSearch
  ]);

  const loadMercadoLivreItemDetail = useCallback(async (item: MercadoLivreSearchItem, options?: { force?: boolean; selectionKey?: string }) => {
    const detailKey = mercadoLivreDetailCacheKey(item);
    if (!detailKey) return item;
    if (enrichedMercadoLivreItemsById[detailKey] && !options?.force) {
      setMercadoLivreDetailCompletedById((current) => (current[detailKey] ? current : { ...current, [detailKey]: true }));
      return enrichedMercadoLivreItemsById[detailKey];
    }
    if (mercadoLivreDetailRequestsRef.current.has(detailKey)) return null;
    if (mercadoLivreDetailErrorsById[detailKey] && !options?.force) {
      setMercadoLivreDetailCompletedById((current) => (current[detailKey] ? current : { ...current, [detailKey]: true }));
      return null;
    }

    if (!item.externalItemId && !item.catalogProductId) {
      const message = "Detalhes indisponiveis para este anuncio.";
      setMercadoLivreDetailErrorsById((current) => ({ ...current, [detailKey]: message }));
      setMercadoLivreDetailCompletedById((current) => ({ ...current, [detailKey]: true }));
      if (options?.selectionKey) {
        setMercadoLivreDetailError({ key: options.selectionKey, message });
      }
      return null;
    }

    mercadoLivreDetailRequestsRef.current.add(detailKey);
    setLoadingMercadoLivreDetailsById((current) => ({ ...current, [detailKey]: true }));
    setMercadoLivreDetailCompletedById((current) => {
      if (!current[detailKey]) return current;
      const next = { ...current };
      delete next[detailKey];
      return next;
    });
    setMercadoLivreDetailErrorsById((current) => {
      if (!current[detailKey]) return current;
      const next = { ...current };
      delete next[detailKey];
      return next;
    });
    if (options?.selectionKey) {
      setMercadoLivreDetailLoadingKey(options.selectionKey);
      setMercadoLivreDetailError(null);
    }

    let detailTimeoutId: number | null = null;

    try {
      const params = new URLSearchParams();
      if (item.externalItemId) params.set("itemId", item.externalItemId);
      if (item.catalogProductId) params.set("catalogProductId", item.catalogProductId);
      appendMercadoLivreBasicDetailParams(params, item);
      const abortController = new AbortController();
      const detailRequest = fetch(`/api/marketplaces/mercado-livre/search/item-detail?${params.toString()}`, {
        cache: "no-store",
        signal: abortController.signal
      }).then(async (response) => ({
        response,
        payload: (await response.json()) as MercadoLivreItemDetailResponse
      }));
      const detailTimeout = new Promise<never>((_, reject) => {
        detailTimeoutId = window.setTimeout(() => {
          abortController.abort();
          reject(new Error("MERCADO_LIVRE_DETAIL_TIMEOUT"));
        }, MERCADO_LIVRE_DETAIL_TIMEOUT_MS);
      });
      const { response, payload } = await Promise.race([detailRequest, detailTimeout]);

      if (!response.ok || !payload.item) {
        const message = payload.error ?? "Nao foi possivel carregar detalhes completos deste anuncio.";
        setMercadoLivreDetailErrorsById((current) => ({ ...current, [detailKey]: message }));
        setMercadoLivreDetailCompletedById((current) => ({ ...current, [detailKey]: true }));
        if (options?.selectionKey) {
          setMercadoLivreDetailError({ key: options.selectionKey, message });
        }
        return null;
      }

      const mergedDetail = mergeMercadoLivreDetailForUi(item, payload.item);
      setEnrichedMercadoLivreItemsById((current) => ({
        ...current,
        [detailKey]: current[detailKey]
          ? mergeMercadoLivreDetailForUi(current[detailKey], mergedDetail)
          : mergedDetail
      }));
      setMercadoLivreDetailCompletedById((current) => ({ ...current, [detailKey]: true }));
      setMercadoLivreSearch((current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((candidate) =>
            isSameMercadoLivreItem(candidate, item) || isSameMercadoLivreItem(candidate, payload.item!)
              ? mergeMercadoLivreDetailForUi(candidate, payload.item!)
              : candidate
          )
        };
      });
      return mergedDetail;
    } catch (error) {
      const message =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.message === "MERCADO_LIVRE_DETAIL_TIMEOUT")
          ? "Tempo esgotado ao carregar detalhes completos deste anuncio."
          : "Erro ao carregar detalhes completos deste anuncio.";
      setMercadoLivreDetailErrorsById((current) => ({ ...current, [detailKey]: message }));
      setMercadoLivreDetailCompletedById((current) => ({ ...current, [detailKey]: true }));
      if (options?.selectionKey) {
        setMercadoLivreDetailError({ key: options.selectionKey, message });
      }
      return null;
    } finally {
      if (detailTimeoutId !== null) window.clearTimeout(detailTimeoutId);
      mercadoLivreDetailRequestsRef.current.delete(detailKey);
      setLoadingMercadoLivreDetailsById((current) => {
        if (!current[detailKey]) return current;
        const next = { ...current };
        delete next[detailKey];
        return next;
      });
      if (options?.selectionKey) {
        setMercadoLivreDetailLoadingKey((current) => (current === options.selectionKey ? null : current));
      }
    }
  }, [enrichedMercadoLivreItemsById, mercadoLivreDetailErrorsById]);

  const selectMercadoLivreResult = useCallback((item: MercadoLivreSearchItem, rankedIndex: number) => {
    const itemKey = mercadoLivreItemKey(item, rankedIndex);
    const detailKey = mercadoLivreDetailCacheKey(item);
    setSelectedMercadoLivreResultKey(itemKey);
    setMercadoLivreDetailError(null);

    if (mercadoLivreDetailCompletedById[detailKey ?? ""] && !mercadoLivreDetailErrorsById[detailKey ?? ""]) return;

    void loadMercadoLivreItemDetail(item, {
      force: Boolean(detailKey && mercadoLivreDetailErrorsById[detailKey]),
      selectionKey: itemKey
    });
  }, [loadMercadoLivreItemDetail, mercadoLivreDetailCompletedById, mercadoLivreDetailErrorsById]);

  useEffect(() => {
    const pageItems = mercadoLivreSearch?.items ?? [];
    if (!pageItems.length) return;

    let cancelled = false;
    let cursor = 0;
    const candidates = pageItems.filter((item) => {
      const detailKey = mercadoLivreDetailCacheKey(item);
      if (!detailKey) return false;
      if (mercadoLivreDetailCompletedById[detailKey]) return false;
      if (enrichedMercadoLivreItemsById[detailKey]) return false;
      if (loadingMercadoLivreDetailsById[detailKey]) return false;
      if (mercadoLivreDetailErrorsById[detailKey]) return false;
      if (mercadoLivreDetailRequestsRef.current.has(detailKey)) return false;
      return true;
    });

    if (!candidates.length) return;

    async function worker() {
      while (!cancelled) {
        const item = candidates[cursor];
        cursor += 1;
        if (!item) break;
        await loadMercadoLivreItemDetail(item);
      }
    }

    const workerCount = Math.min(MERCADO_LIVRE_DETAIL_CONCURRENCY, candidates.length);
    void Promise.all(Array.from({ length: workerCount }, () => worker()));

    return () => {
      cancelled = true;
    };
  }, [
    enrichedMercadoLivreItemsById,
    loadingMercadoLivreDetailsById,
    loadMercadoLivreItemDetail,
    mercadoLivreDetailCompletedById,
    mercadoLivreCurrentPageDetailSignature,
    mercadoLivreDetailErrorsById,
    mercadoLivreSearch?.items
  ]);

  useEffect(() => {
    if (!mercadoLivreSearch?.items.length) return;
    if (!mercadoLivreNeedsMoreOffersForPage) return;
    if (mercadoLivreSearchLoading || mercadoLivreOfferCollecting || mercadoLivreCurrentPageDetailsInProgress) return;
    void loadMoreMercadoLivreOfferCandidates();
  }, [
    loadMoreMercadoLivreOfferCandidates,
    mercadoLivreCurrentPageDetailsInProgress,
    mercadoLivreNeedsMoreOffersForPage,
    mercadoLivreOfferCollecting,
    mercadoLivreSearch?.items.length,
    mercadoLivreSearchLoading
  ]);

  function goToMercadoLivrePage(page: number) {
    if (!mercadoLivreSearch) return;
    const nextPage = Math.max(1, page);
    setMercadoLivreOfferPage(nextPage);
  }

  function changeMercadoLivrePageSize(value: string) {
    const nextPageSize = Math.min(20, Math.max(1, Number(value) || 10));
    setMercadoLivrePageSize(nextPageSize);
    const mode = mercadoLivreSearch?.requestedSearchMode ?? mercadoLivreSearch?.searchMode;
    if (mode) void searchMercadoLivreReadOnly(mode, { page: 1, pageSize: nextPageSize });
  }

  async function importMercadoLivreReference() {
    const rawInput = referenceImportInput.trim();
    if (!rawInput) {
      setReferenceImportError("Informe um link ou ID valido de anuncio Mercado Livre.");
      return;
    }
    if (!mercadoLivreConnected) {
      setReferenceImportError("Conecte uma conta Mercado Livre antes de importar uma referencia.");
      return;
    }

    setReferenceImportLoading(true);
    setReferenceImportError(null);
    setReferenceImportErrorDetails(null);
    try {
      const response = await fetch("/api/marketplaces/mercado-livre/import-by-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: rawInput,
          productId: product?.productId ?? undefined
        })
      });
      const payload = (await response.json()) as MercadoLivreReferenceImportResponse;
      if (!response.ok || payload.error) {
        setReferenceImportError(payload.error ?? "Nao foi possivel importar a referencia Mercado Livre.");
        setReferenceImportErrorDetails(payload);
        return;
      }

      if (!payload.reference) {
        setReferenceImportError("Nao foi possivel importar a referencia Mercado Livre.");
        setReferenceImportErrorDetails(payload);
        return;
      }

      setReferenceImport(payload.reference);
      setSelectedMercadoLivreSuggestion(null);
      setSelectedMercadoLivreFields(new Set());
      setReferenceImportInput(payload.normalizedItemId ?? payload.reference.externalItemId);
      setReferenceImportErrorDetails(null);
      setReferenceImportOpen(false);
      setMessage("Referencia Mercado Livre importada como DRAFT local. Nada foi salvo no Product e nada foi publicado.");
      openProductPreview({
        title: payload.reference.title,
        brand: payload.reference.brand,
        images: [payload.reference.thumbnail, ...imageUrlsFromUnknown(payload.reference.pictures)]
      });
    } catch {
      setReferenceImportError("Erro ao importar referencia Mercado Livre. Nenhuma escrita externa foi executada.");
      setReferenceImportErrorDetails(null);
    } finally {
      setReferenceImportLoading(false);
    }
  }

  function openProductPreview(input: {
    title?: string | null;
    brand?: string | null;
    images?: Array<string | null | undefined>;
  }) {
    const title = normalizeIntelligentProductPreviewTitle(input.title) || product?.name || "";
    const brand = normalizeIntelligentProductPreviewBrand(input.brand) ?? normalizeIntelligentProductPreviewBrand(product?.brand);
    const suggestionImages = normalizeIntelligentProductPreviewImages(input.images);
    const images = suggestionImages.length
      ? suggestionImages
      : normalizeIntelligentProductPreviewImages(product?.imageUrl ? [product.imageUrl] : []);

    setPreviewTitle(title);
    setPreviewBrand(brand ?? "");
    setPreviewBrandVisible(Boolean(brand));
    setPreviewImages(images);
    setPreviewSelectedIndex(0);
    setActivePanel("extracted");
  }

  function selectMercadoLivreSuggestion(item: MercadoLivreSearchItem) {
    const resultIndex = rankedMercadoLivreItems.findIndex(({ item: candidate }) => candidate === item || Boolean(item.externalItemId && candidate.externalItemId === item.externalItemId));
    if (resultIndex >= 0) setSelectedMercadoLivreResultKey(mercadoLivreItemKey(item, resultIndex));
    setSelectedMercadoLivreSuggestion(item);
    setReferenceImport(null);
    setSelectedReferenceFields(new Set());
    const defaultFields = new Set<string>();
    if (item.title && !product?.name) defaultFields.add("name");
    if (item.brand && !product?.brand) defaultFields.add("brand");
    if (item.gtin && !product?.gtin) defaultFields.add("ean");
    if (item.imageUrl && !product?.imageUrl) defaultFields.add("imageUrl");
    setSelectedMercadoLivreFields(defaultFields);
    setMessage("Sugestao Mercado Livre carregada para revisao.");
    openProductPreview({
      title: item.title,
      brand: item.brand,
      images: mercadoLivreDetailImageUrls(item)
    });
  }

  function closeProductPreview() {
    setActivePanel(null);
    setPreviewTitle("");
    setPreviewBrand("");
    setPreviewBrandVisible(false);
    setPreviewImages([]);
    setPreviewSelectedIndex(0);
  }

  function navigatePreviewImage(direction: -1 | 1) {
    if (previewImages.length < 2) return;
    setPreviewSelectedIndex((current) =>
      (current + direction + previewImages.length) % previewImages.length
    );
  }

  function removeSelectedPreviewImage() {
    setPreviewImages((current) => {
      const next = current.filter((_, index) => index !== previewSelectedIndex);
      setPreviewSelectedIndex((selectedIndex) => Math.min(selectedIndex, Math.max(0, next.length - 1)));
      return next;
    });
  }

  function makeSelectedPreviewImagePrimary() {
    if (previewSelectedIndex <= 0) return;
    setPreviewImages((current) => {
      const selected = current[previewSelectedIndex];
      if (!selected) return current;
      return [selected, ...current.filter((_, index) => index !== previewSelectedIndex)];
    });
    setPreviewSelectedIndex(0);
  }

  async function saveProductPreview() {
    if (saveInFlightRef.current || saving) return;
    if (!product) {
      setMessage("Não foi possível salvar o produto agora.");
      return;
    }

    const fields = buildIntelligentProductPreviewFields({
      name: previewTitle,
      brand: previewBrandVisible ? previewBrand : undefined,
      images: previewImages
    });
    if (!fields.name) {
      setMessage("Informe um título para salvar o produto.");
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/products/intelligent-registration/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.productId,
          fields
        })
      });

      if (!response.ok) {
        setMessage("Não foi possível salvar o produto agora.");
        return;
      }

      closeProductPreview();
      setSelectedMercadoLivreSuggestion(null);
      setSelectedMercadoLivreFields(new Set());
      setReferenceImport(null);
      setSelectedReferenceFields(new Set());
      resetAmazonReferenceState(product);
      await search();
      setMessage("Produto atualizado com sucesso.");
    } catch {
      setMessage("Não foi possível salvar o produto agora.");
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }


  const auxiliaryPanelTitle =
    activePanel === "product"
      ? "Produto interno"
      : activePanel === "extracted"
        ? "Dados extraidos"
        : "Historico / Revisao";

  const productPanelContent = (
    <div className="space-y-4">
      {product ? (
        <section className="rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <ProductHeroImage alt={product.name} src={product.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-matrix-fg">Produto localizado no W Ecommerce</h4>
                <Badge tone="success">{lookup?.productMatchType ?? "SKU"}</Badge>
              </div>
              <p className="mt-2 break-words text-lg font-semibold text-matrix-fg">{product.name}</p>
              <div className="mt-3 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">
                <span>SKU: {formatValue(product.sku)}</span>
                <span>GTIN: {formatValue(product.gtin)}</span>
                <span>Marca: {formatValue(product.brand)}</span>
                <span>Origem: {formatValue(product.source)}</span>
                <span>Conta: {formatValue(product.blingAccount?.name)}</span>
                <span>ID externo: {formatValue(product.blingAccount?.externalProductId)}</span>
                <span>Status externo: {product.syncStatus === "NOT_SYNCED" ? "Nao publicado" : product.syncStatus}</span>
                <span>Estoque local: {formatValue(product.stock)}</span>
              </div>
              {product.description ? (
                <div className="mt-3 rounded-md border border-matrix-border bg-matrix-panel2/70 p-3 text-sm text-matrix-muted">
                  <p className="font-semibold text-matrix-fg">Descricao local</p>
                  <p className="mt-1">{product.description}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : lookup ? (
        <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
          <div className="flex items-center gap-2 text-matrix-muted">
            <PackageSearch className="h-5 w-5" />
            <p className="font-semibold text-matrix-fg">SKU nao encontrado no W Ecommerce.</p>
          </div>
          <p className="mt-2 text-sm text-matrix-muted">Voce pode consultar o GTIN interno, mas o salvamento local exige um Product interno localizado.</p>
        </section>
      ) : (
        <section className="grid min-h-64 place-items-center rounded-lg border border-matrix-border bg-matrix-panel2/45 p-8 text-center">
          <div>
            <Database className="mx-auto h-10 w-10 text-matrix-goldDark" />
            <p className="mt-3 font-semibold text-matrix-fg">Aguardando busca</p>
            <p className="mt-1 max-w-md text-sm text-matrix-muted">Digite um SKU interno para ver os dados locais do Product aqui.</p>
          </div>
        </section>
      )}

      {gtinCatalog ? (
        <section className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-4">
          <div className="flex gap-3">
            <ProductImage alt={gtinCatalog.name} src={gtinCatalog.imageUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-semibold text-matrix-fg">Fonte: Banco GTIN do SaaS</h4>
                <Badge tone={confidenceTone(gtinCatalog.confidenceScore)}>{gtinCatalog.confidenceScore}%</Badge>
              </div>
              <p className="mt-1 font-semibold text-matrix-fg">{gtinCatalog.name}</p>
              <div className="mt-2 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">
                <span>GTIN: {gtinCatalog.normalizedGtin}</span>
                <span>Marca: {formatValue(gtinCatalog.brand)}</span>
                <span>NCM: {formatValue(gtinCatalog.ncm)}</span>
                <span>Unidade: {formatValue(gtinCatalog.unit)}</span>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {lookup?.sourceResults.length ? (
        <section className="rounded-lg border border-matrix-border bg-matrix-panel2/40">
          <div className="border-b border-matrix-border px-4 py-3">
            <h4 className="font-semibold text-matrix-fg">Resultados de fontes autorizadas</h4>
            <p className="text-sm text-matrix-muted">Somente W Ecommerce e banco GTIN do SaaS nesta etapa.</p>
          </div>
          <div className="divide-y divide-matrix-border">
            {lookup.sourceResults.map((result) => (
              <div key={`${result.type}-${result.id}`} className="flex gap-3 px-4 py-3">
                <ProductImage alt={result.name} src={result.imageUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={result.type === "PRODUCT" ? "success" : "info"}>{result.source}</Badge>
                    <Badge tone={confidenceTone(result.confidenceScore)}>{result.confidenceScore}%</Badge>
                  </div>
                  <p className="mt-1 font-semibold text-matrix-fg">{result.name}</p>
                  <p className="mt-1 text-sm text-matrix-muted">SKU {formatValue(result.sku)} | GTIN {formatValue(result.gtin)} | Marca {formatValue(result.brand)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );

  const extractedPanelContent = (
    <IntelligentProductPreview
      brand={previewBrand}
      canSave={Boolean(product)}
      images={previewImages}
      onBack={closeProductPreview}
      onBrandChange={setPreviewBrand}
      onMakePrimary={makeSelectedPreviewImagePrimary}
      onNavigateImage={navigatePreviewImage}
      onRemoveImage={removeSelectedPreviewImage}
      onSave={saveProductPreview}
      onSelectImage={setPreviewSelectedIndex}
      onTitleChange={setPreviewTitle}
      saving={saving}
      selectedIndex={previewSelectedIndex}
      showBrand={previewBrandVisible}
      title={previewTitle}
    />
  );


  const historyPanelContent = (
    <div className="space-y-4">
      {product ? (
        <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-matrix-fg">Historico do Cadastro Inteligente</p>
              <p className="mt-1 text-xs text-matrix-muted">Aplicacoes locais registradas para este produto.</p>
            </div>
            <Badge tone={enrichmentHistory.length ? "info" : "muted"}>{historyLoading ? "Carregando" : `${enrichmentHistory.length} registro(s)`}</Badge>
          </div>
          {enrichmentHistory.length ? (
            <div className="mt-3 space-y-2">
              {enrichmentHistory.map((entry) => (
                <div key={entry.id} className="rounded-md border border-matrix-border bg-matrix-panel/70 p-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-matrix-fg">{formatDateTime(entry.createdAt)}</p>
                      <p className="mt-1 text-xs text-matrix-muted">
                        {entry.userName} | {entry.sourceProvider}
                        {entry.sourceExternalId ? ` | ${entry.sourceExternalId}` : ""}
                      </p>
                    </div>
                    {entry.compatibilityLevel ? (
                      <Badge tone={compatibilityTone(entry.compatibilityLevel)}>{entry.compatibilityLevel}</Badge>
                    ) : (
                      <Badge tone="muted">Sem score</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-matrix-muted">Campos: {entry.fieldsChanged.join(", ") || "Sem campos registrados"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button onClick={() => setSelectedHistory(entry)} type="button" variant="secondary">
                      Ver detalhes
                    </Button>
                    {entry.sourceUrl ? (
                      <a
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
                        href={entry.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Origem
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/60 p-3 text-xs text-matrix-muted">
              Nenhuma aplicacao local registrada para este produto ainda.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-5 text-center text-sm text-matrix-muted">
          Busque um Product local para ver o historico de Cadastro Inteligente.
        </div>
      )}

      {selectedHistory ? (
        <div className="rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-matrix-fg">Detalhes do historico</p>
              <p className="mt-1 text-xs text-matrix-muted">{formatDateTime(selectedHistory.createdAt)} por {selectedHistory.userName}</p>
            </div>
            <Button onClick={() => setSelectedHistory(null)} type="button" variant="secondary">
              Fechar detalhes
            </Button>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-matrix-muted sm:grid-cols-2">
            <span>Produto/SKU: {formatValue(selectedHistory.productSku)}</span>
            <span>Origem: {selectedHistory.sourceProvider}</span>
            <span>Anuncio/referencia: {formatValue(selectedHistory.sourceExternalId)}</span>
            <span>Compatibilidade: {formatValue(selectedHistory.compatibilityLevel)} {selectedHistory.compatibilityScore !== null ? `(${selectedHistory.compatibilityScore}/100)` : ""}</span>
            <span>Confirmacao principal: {selectedHistory.confirmationMainUsed ? "Usada" : "Nao usada"}</span>
            <span>Confirmacao baixa compatibilidade: {selectedHistory.confirmationLowCompatibilityUsed ? "Usada" : "Nao usada"}</span>
          </div>
          <div className="mt-3 space-y-2">
            {selectedHistory.fieldsChanged.map((field) => (
              <div key={field} className="rounded-md border border-matrix-border bg-matrix-panel2/70 p-2">
                <p className="font-semibold text-matrix-fg">{field}</p>
                <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                  <span className="rounded border border-matrix-border bg-matrix-panel p-2 text-matrix-muted">
                    Valor antigo: <span className="break-words text-matrix-fg">{formatHistoryValue(selectedHistory.oldValues[field])}</span>
                  </span>
                  <span className="rounded border border-matrix-border bg-matrix-panel p-2 text-matrix-muted">
                    Valor novo: <span className="break-words text-matrix-fg">{formatHistoryValue(selectedHistory.newValues[field])}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-matrix-muted">Historico local do W Ecommerce. Nada foi enviado ao Bling ou publicado no Mercado Livre por este registro.</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <AppShell>
      <PageHeader
        title="Cadastro Inteligente de Produtos"
        description="Busque pelo SKU, GTIN ou titulo. Revise antes de salvar."
        actions={
          <Link
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
            href="/products"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para produtos
          </Link>
        }
      />

      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["1", "Buscar", "SKU, GTIN ou titulo"],
            ["2", "Selecionar fonte", "Product e GTIN primeiro"],
            ["3", "Revisar dados", "Atual x sugerido"],
            ["4", "Salvar localmente", "Com confirmacao"]
          ].map(([step, title, hint], index) => (
            <div key={step} className={`rounded-md border p-3 ${index === 0 ? "border-matrix-gold/55 bg-matrix-goldSoft/30" : "border-matrix-border bg-matrix-panel/70"}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-bold ${index === 0 ? "border-matrix-gold bg-matrix-gold text-black" : "border-matrix-border text-matrix-muted"}`}>
                  {step}
                </span>
                <div>
                  <p className="font-semibold text-matrix-fg">{title}</p>
                  <p className="text-xs text-matrix-muted">{hint}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-lg border border-matrix-border bg-matrix-panel/88 p-4 shadow-glow">
          <form onSubmit={search}>
            <div className="flex items-center gap-2 text-matrix-goldDark">
              <Search className="h-5 w-5" />
              <h3 className="font-semibold text-matrix-fg">Buscar produto</h3>
            </div>
            <label className="mt-4 grid gap-2 text-sm text-matrix-muted">
              SKU interno
              <div className="flex rounded-md border border-matrix-border bg-matrix-panel focus-within:border-matrix-gold/60">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-matrix-fg outline-none"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Ex.: 916"
                  value={query}
                />
                <button className="grid w-11 place-items-center text-matrix-goldDark" disabled={loading} title="Buscar localmente" type="submit">
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </label>
            <Button className="mt-3 w-full justify-center" disabled={loading} type="submit">
              {loading ? "Buscando..." : "Buscar produto"}
            </Button>
          </form>
          <p className="rounded-md border border-matrix-border bg-matrix-panel2/58 p-3 text-xs text-matrix-muted">{message}</p>

          {product ? (
            <div className="rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18 p-3">
              <div className="flex gap-3">
                <ProductImage alt={product.name} src={product.imageUrl} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-matrix-goldDark">Produto encontrado</p>
                  <p className="mt-1 break-words font-semibold text-matrix-fg">{product.name}</p>
                  <div className="mt-2 space-y-1 text-xs text-matrix-muted">
                    <p>SKU: {formatValue(product.sku)}</p>
                    <p>GTIN do produto: {formatValue(selectedProductGtin)}</p>
                    <p>Marca: {formatValue(product.brand)}</p>
                    <p>Conta: {formatValue(product.blingAccount?.name)}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : lookup ? (
            <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3 text-sm text-matrix-muted">
              Nenhum Product local foi localizado para esta busca.
            </div>
          ) : null}

          <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-matrix-fg">GTIN interno</p>
                <p className="mt-1 text-xs text-matrix-muted">Consulta o banco mestre GTIN do SaaS.</p>
              </div>
              <Badge tone="muted">Local</Badge>
            </div>
            <Button className="mt-3 w-full justify-center" disabled={internalGtinLoading || !selectedProductGtin} onClick={consultInternalGtinCatalog} type="button" variant="secondary">
              <Database className="h-4 w-4" />
              {internalGtinLoading ? "Consultando..." : "Consultar GTIN interno"}
            </Button>
            {product && !selectedProductGtin && !internalGtinChecked ? (
              <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-2 text-xs text-matrix-muted">
                Este produto nao possui GTIN/EAN cadastrado.
              </p>
            ) : null}
            {internalGtinChecked ? (
              internalGtinLoading ? (
                <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-2 text-xs text-matrix-muted">
                  Consultando banco mestre GTIN do SaaS...
                </p>
              ) : internalGtinCatalog ? (
                <div className="mt-3 rounded-md border border-matrix-gold/25 bg-matrix-goldSoft/14 p-3">
                  {selectedProductGtin ? (
                    <p className="mb-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-2 text-xs font-semibold text-matrix-fg">
                      GTIN do produto identificado: {selectedProductGtin}
                    </p>
                  ) : null}
                  <div className="flex gap-3">
                    <ProductImage alt={internalGtinCatalog.name} size="sm" src={internalGtinCatalog.imageUrl} />
                    <div className="min-w-0 text-xs text-matrix-muted">
                      <p className="font-semibold text-matrix-fg">Registro encontrado no banco mestre GTIN</p>
                      <p className="mt-1 font-semibold text-matrix-fg">{internalGtinCatalog.name}</p>
                      <p className="mt-1">GTIN/EAN: {internalGtinCatalog.normalizedGtin}</p>
                      <p>Marca: {formatValue(internalGtinCatalog.brand)}</p>
                      <p>NCM: {formatValue(internalGtinCatalog.ncm)}</p>
                      <p>Unidade: {formatValue(internalGtinCatalog.unit)}</p>
                      <p>Origem: Banco mestre GTIN do SaaS</p>
                    </div>
                  </div>
                  {internalGtinCatalog.description ? <p className="mt-2 line-clamp-3 text-xs text-matrix-muted">{internalGtinCatalog.description}</p> : null}
                </div>
              ) : selectedProductGtin && internalGtinState !== "error" ? (
                <div className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-3 text-xs text-matrix-muted">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="muted">Nao catalogado</Badge>
                      <span className="font-semibold text-matrix-fg">GTIN do produto identificado: {selectedProductGtin}</span>
                    </div>
                    <p>Este GTIN ainda nao possui registro enriquecido no banco mestre GTIN do SaaS.</p>
                    <Button className="w-full justify-center" disabled title="Fluxo seguro para OWNER sera ativado em etapa futura." type="button" variant="secondary">
                      <Database className="h-4 w-4" />
                      Cadastrar este GTIN no banco mestre
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel/70 p-2 text-xs text-matrix-muted">
                  {selectedProductGtin ? internalGtinStatusMessage ?? "Nao foi possivel consultar o banco mestre GTIN agora." : "Este produto nao possui GTIN/EAN cadastrado."}
                </p>
              )
            ) : null}
            {product || internalGtinDiagnostic || mercadoLivreLastQuery ? (
              <details className="mt-2 rounded-md border border-matrix-border bg-matrix-panel/60 px-2 py-1 text-[11px] text-matrix-muted">
                <summary className="cursor-pointer font-semibold text-matrix-fg">Diagnostico seguro</summary>
                <div className="mt-2 space-y-1">
                  <p>Product SKU: {formatValue(selectedProductSku)}</p>
                  <p>Product GTIN: {formatValue(selectedProductGtin)}</p>
                  <p>Product titulo: {formatValue(selectedProductName)}</p>
                  <p>Product marca: {formatValue(selectedProductBrand)}</p>
                  <p>GTIN interno: {internalGtinStatusLabel(internalGtinDiagnostic?.internalGtinStatus ?? internalGtinState)}</p>
                  <p>Mercado Livre GTIN: {mercadoLivreStatusLabel(mercadoLivreGtinStatus)}</p>
                  <p>Mercado Livre titulo: {mercadoLivreStatusLabel(mercadoLivreTitleStatus)}</p>
                  <p>internalGtinLastQuery: {formatValue(internalGtinDiagnostic?.internalGtinLastQuery)}</p>
                  <p>internalGtinStatus: {internalGtinDiagnostic?.internalGtinStatus ?? internalGtinState}</p>
                  <p>Endpoint GTIN interno: {internalGtinDiagnostic?.endpoint ?? "/api/gtin/search"}</p>
                  <p>internalGtinFoundCount: {internalGtinDiagnostic?.foundCount ?? 0}</p>
                  <p>ID GTIN interno encontrado: {formatValue(internalGtinDiagnostic?.foundId)}</p>
                  <p>mercadoLivreLastQuery: {formatValue(mercadoLivreLastQuery)}</p>
                  <p>mercadoLivreSearchMode: {formatValue(mercadoLivreLastSearchMode)}</p>
                  <p>mercadoLivreStatus: {mercadoLivreSearchState}</p>
                  <p>mercadoLivreHttpStatus: {formatValue(mercadoLivreHttpStatus)}</p>
                  <p>mercadoLivreItemsCount: {formatValue(mercadoLivreItemsCount)}</p>
                </div>
              </details>
            ) : null}
          </div>

          <div className="rounded-lg border border-matrix-border bg-matrix-panel2/58 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-matrix-fg">Cadastro Automático</p>
              </div>
              <Badge tone="muted">Referencias</Badge>
            </div>
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-matrix-fg" htmlFor="amazon-catalog-gtin">
                <AmazonLogo size={18} />
                GTIN
              </label>
              <input
                autoComplete="off"
                className="w-full rounded-md border border-matrix-border bg-matrix-panel px-3 py-2 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                id="amazon-catalog-gtin"
                inputMode="numeric"
                onChange={(event) => {
                  setAmazonGtinInput(event.target.value);
                  setAmazonCatalogState("idle");
                  setAmazonCatalogItems([]);
                  setAmazonCatalogMessage(null);
                  resetAmazonReferenceState(product);
                }}
                placeholder="GTIN/EAN do produto"
                value={amazonGtinInput}
              />
              <Button
                className="w-full justify-center"
                disabled={amazonCatalogState === "loading" || (!amazonGtinInput.trim() && !selectedProductName?.trim() && !query.trim())}
                onClick={searchAmazonCatalog}
                type="button"
                variant="secondary"
              >
                <AmazonLogo size={18} />
                {amazonCatalogState === "loading" ? "Buscando referencia na Amazon..." : "Buscar na Amazon"}
              </Button>
              {amazonCatalogMessage && amazonCatalogState !== "success" ? (
                <p className="rounded-md border border-matrix-border bg-matrix-panel/70 p-2 text-xs text-matrix-muted">
                  {amazonCatalogMessage}
                </p>
              ) : null}
            </div>
            {!mercadoLivreConnected && mercadoLivreConfigured ? (
              <Button className="mt-3 w-full justify-center" onClick={connectMercadoLivre} type="button" variant="secondary">
                <MercadoLivreLogo size={18} />
                Conectar Mercado Livre
              </Button>
            ) : null}
            {mercadoLivreConnected ? (
              <div className="mt-3 space-y-2 border-t border-matrix-border pt-3">
                <Button className="w-full justify-center" disabled={mercadoLivreSearchLoading || (!selectedProductName && !query.trim())} onClick={() => searchMercadoLivreReadOnly("title")} type="button" variant="secondary">
                  <MercadoLivreLogo size={18} />
                  Título
                </Button>
                <Button className="w-full justify-center" onClick={() => setReferenceImportOpen(true)} type="button">
                  <MercadoLivreLogo size={18} />
                  Importar anuncio por link/ID
                </Button>
              </div>
            ) : null}
          </div>

          <p className="rounded-md border border-matrix-border bg-matrix-panel2/58 p-3 text-xs text-matrix-muted">
            Nada e publicado automaticamente. Product, estoque e financeiro so mudam quando o usuario confirma um salvamento local permitido.
          </p>
        </aside>

        <main className="min-w-0 rounded-lg border border-matrix-border bg-matrix-panel/88 shadow-glow">
          <div className="border-b border-matrix-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-matrix-fg">
                  <PackageSearch className="h-4 w-4 text-matrix-goldDark" />
                  Referencias de cadastro
                </h3>
                <p className="text-sm text-matrix-muted">Resultados Amazon e Mercado Livre para revisao antes de qualquer uso local.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 overflow-visible p-4">
            {amazonCatalogState !== "idle" ? (
              <section className="rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-matrix-border px-4 py-3">
                  <div>
                    <h4 className="flex items-center gap-2 font-semibold text-matrix-fg">
                      <AmazonLogo size={18} />
                      Referencias Amazon
                    </h4>
                    <p className="text-sm text-matrix-muted">
                      {amazonCatalogMessage ?? "Consulte referencias para revisar os dados do produto."}
                    </p>
                  </div>
                  {selectedAmazonReferenceAsin ? <Badge tone="success">Referência selecionada</Badge> : null}
                </div>

                {amazonCatalogState === "loading" ? (
                  <div className="grid min-h-36 place-items-center p-6 text-center">
                    <div>
                      <Search className="mx-auto h-8 w-8 text-matrix-goldDark" />
                      <p className="mt-3 text-sm font-semibold text-matrix-fg">Buscando referencia na Amazon...</p>
                    </div>
                  </div>
                ) : null}

                {amazonCatalogState === "empty" || amazonCatalogState === "unavailable" || amazonCatalogState === "error" ? (
                  <div className="p-4">
                    <p className="rounded-md border border-matrix-border bg-matrix-panel/70 p-3 text-sm text-matrix-muted">
                      {amazonCatalogMessage}
                    </p>
                  </div>
                ) : null}

                {amazonCatalogState === "success" && amazonCatalogItems.length ? (
                  <div className="grid gap-3 p-4 md:grid-cols-2">
                    {amazonCatalogItems.map((item) => {
                      const selected = selectedAmazonReferenceAsin === item.asin;
                      const identifiers = item.identifiers.map((identifier) => `${identifier.type}: ${identifier.value}`).join(" | ");
                      return (
                        <article
                          className={`rounded-lg border p-3 ${selected ? "border-matrix-gold bg-matrix-goldSoft/30" : "border-matrix-border bg-matrix-panel/72"}`}
                          key={item.asin}
                        >
                          <div className="flex gap-3">
                            <ProductImage alt={item.title ?? "Referencia Amazon"} size="sm" src={item.imageUrl} />
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 font-semibold text-matrix-fg">{formatValue(item.title)}</p>
                              <div className="mt-2 space-y-1 text-xs text-matrix-muted">
                                <p>ASIN: {item.asin}</p>
                                <p>Marca: {formatValue(item.brand)}</p>
                                <p className="break-words">{identifiers || "GTIN/EAN/UPC: -"}</p>
                                <p>Tipo do produto: {formatValue(item.productType)}</p>
                              </div>
                            </div>
                          </div>
                          <Button
                            className="mt-3 w-full justify-center"
                            onClick={() => selectAmazonReference(item)}
                            type="button"
                            variant={selected ? "secondary" : "primary"}
                          >
                            {selected ? "Referência selecionada" : "Usar como referência"}
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                ) : null}

                {selectedAmazonReference ? (
                  <div className="border-t border-matrix-border px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-matrix-fg">Referência escolhida para revisão</p>
                        <p className="mt-1 text-sm text-matrix-muted">Compare as informações antes de aplicar.</p>
                        <p className="mt-2 text-xs text-matrix-muted">
                          Imagem exibida apenas como referência para conferência.
                        </p>
                      </div>
                      <Button className="shrink-0" onClick={openAmazonDraftReview} type="button">
                        <WandSparkles className="h-4 w-4" />
                        Aplicar ao rascunho
                      </Button>
                    </div>

                    {amazonDraftReviewOpen ? (
                      <div className="mt-4 border-t border-matrix-border pt-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-matrix-fg">
                              {amazonReferenceHasConflicts
                                ? "Alguns campos já possuem informações. Escolha quais sugestões deseja usar."
                                : "Compare as informações antes de aplicar."}
                            </p>
                            <p className="mt-1 text-xs text-matrix-muted">As alterações ainda não foram salvas.</p>
                          </div>
                          <Button onClick={applyAmazonOnlyToEmptyFields} type="button" variant="secondary">
                            <Check className="h-4 w-4" />
                            Aplicar somente nos campos vazios
                          </Button>
                        </div>

                        <div className="mt-4 divide-y divide-matrix-border border-y border-matrix-border">
                          {amazonReferenceReviewRows.map((row) => {
                            const attributeEntries =
                              row.field === "attributes" && typeof row.suggested !== "string"
                                ? Object.entries(row.suggested)
                                : [];
                            return (
                              <div className="py-4" key={row.field}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-semibold text-matrix-fg">{row.label}</p>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {row.conflict ? <Badge tone="warning">Revisar</Badge> : null}
                                    {row.matchesCurrent ? <Badge tone="success">Já corresponde</Badge> : null}
                                    {row.applied ? <Badge tone="success">Sugestão Amazon</Badge> : null}
                                    {row.kept ? <Badge tone="muted">Valor atual mantido</Badge> : null}
                                  </div>
                                </div>

                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                  <div className="min-w-0 border-l-2 border-matrix-border pl-3">
                                    <p className="text-matrix-muted">Valor atual:</p>
                                    <p className="mt-1 break-words text-matrix-fg">
                                      {amazonDraftDisplayValue(row.field, row.current)}
                                    </p>
                                  </div>
                                  <div className="min-w-0 border-l-2 border-matrix-gold/50 pl-3">
                                    <p className="text-matrix-muted">Sugestão Amazon:</p>
                                    <p className="mt-1 break-words text-matrix-fg">
                                      {amazonDraftDisplayValue(row.field, row.suggested)}
                                    </p>
                                  </div>
                                </div>

                                {attributeEntries.length ? (
                                  <div className="matrix-scroll mt-3 grid max-h-40 gap-2 overflow-y-auto pr-1 text-xs sm:grid-cols-2">
                                    {attributeEntries.map(([key, value]) => (
                                      <div className="flex min-w-0 justify-between gap-3 border-b border-matrix-border/70 pb-2" key={key}>
                                        <span className="text-matrix-muted">{amazonAttributeLabel(key)}</span>
                                        <span className="break-words text-right text-matrix-fg">
                                          {Array.isArray(value) ? value.join(", ") : value}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}

                                {row.applied ? (
                                  <p className="mt-3 text-xs text-matrix-muted">
                                    No rascunho: <span className="font-medium text-matrix-fg">{amazonDraftDisplayValue(row.field, amazonDraft.values[row.field])}</span>
                                  </p>
                                ) : null}

                                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                  <Button
                                    className="sm:min-w-36"
                                    onClick={() => keepAmazonCurrentValue(row.field)}
                                    type="button"
                                    variant="ghost"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    Manter atual
                                  </Button>
                                  <Button
                                    className="sm:min-w-36"
                                    disabled={!row.hasSuggestion || row.matchesCurrent}
                                    onClick={() => applyAmazonSuggestionToDraft(row.field)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    <Check className="h-4 w-4" />
                                    Usar sugestão
                                  </Button>
                                </div>

                                {!row.persistsWithExistingSave ? (
                                  <p className="mt-2 text-xs text-matrix-muted">
                                    Esta informação permanece somente no rascunho para conferência.
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <p className="mt-3 text-xs text-matrix-muted">
                          ASIN, identificadores, tipo, características e imagem de referência não são incluídos no salvamento do produto.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {!mercadoLivreSearch && !referenceImport && amazonCatalogState === "idle" ? (
              <section className="grid min-h-[260px] place-items-center rounded-lg border border-matrix-border bg-matrix-panel2/45 p-8 text-center">
                <div>
                  <Search className="mx-auto h-10 w-10 text-matrix-goldDark" />
                  <p className="mt-3 font-semibold text-matrix-fg">
                    {mercadoLivreSearchLoading ? "Aguardando resultados Mercado Livre" : "Mercado Livre pronto para consulta"}
                  </p>
                  <p className="mt-1 max-w-md text-sm text-matrix-muted">
                    {mercadoLivreSearchLoading
                      ? mercadoLivreStatusMessage ?? "Consulta read-only em andamento. Nenhuma escrita externa sera executada."
                      : mercadoLivreStatusMessage ??
                        "Use os botoes Mercado Livre GTIN ou Titulo para consultar sugestoes externas. A consulta GTIN interno fica isolada na lateral."}
                  </p>
                </div>
              </section>
            ) : null}

            {mercadoLivreSearch || referenceImport ? (
              <section className="rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18">
                <div className="border-b border-matrix-border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="flex items-center gap-2 font-semibold text-matrix-fg">
                        <MercadoLivreLogo size={18} />
                        Sugestoes Mercado Livre
                      </h4>
                      {mercadoLivreSearch ? (
                        <p className="text-sm text-matrix-muted">
                          {mercadoLivreSearchResultLabel(mercadoLivreSearch, mercadoLivreEffectiveSearchType, mercadoLivreEffectiveSearchValue)}
                        </p>
                      ) : (
                        <p className="text-sm text-matrix-muted">Referencia importada por link/ID para revisao local.</p>
                      )}
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <Badge tone="success">Conectado</Badge>
                      {mercadoLivreSearchUnavailable ? (
                        <span className="text-[11px] leading-tight text-matrix-muted">
                          Busca API indisponivel
                          <br />
                          Fallback manual ativo
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {mercadoLivreNotice && !mercadoLivreGtinCatalogEmpty ? (
                    <div className="mt-3 rounded-md border border-matrix-border bg-matrix-panel2/60 p-3 text-xs text-matrix-muted">
                      <p>{mercadoLivreNotice}</p>
                    </div>
                  ) : null}
                  {mercadoLivreSearchUnavailable ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button disabled={!mercadoLivreCopyGtinValue} onClick={() => copyText(mercadoLivreCopyGtinValue, "GTIN")} type="button" variant="secondary">
                        <Copy className="h-4 w-4" />
                        Copiar GTIN
                      </Button>
                      <Button disabled={!mercadoLivreCopyTitleValue} onClick={() => copyText(mercadoLivreCopyTitleValue, "Titulo")} type="button" variant="secondary">
                        <Copy className="h-4 w-4" />
                        Copiar titulo
                      </Button>
                      {mercadoLivreGtinSearchBlocked && mercadoLivreGtinManualSearchUrl ? (
                        <a
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
                          href={mercadoLivreGtinManualSearchUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <MercadoLivreLogo size={18} />
                          Abrir busca no Mercado Livre por GTIN
                        </a>
                      ) : null}
                      {mercadoLivreManualSearchUrl && (!mercadoLivreGtinSearchBlocked || mercadoLivreManualSearchUrl !== mercadoLivreGtinManualSearchUrl) ? (
                        <a
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
                          href={mercadoLivreManualSearchUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <MercadoLivreLogo size={18} />
                          Abrir busca no Mercado Livre
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {referenceImport ? (
                  <div className="border-b border-matrix-border px-4 py-4">
                    <div className="flex gap-3">
                      <ProductImage alt={referenceImport.title ?? "Referencia Mercado Livre"} src={referenceImport.thumbnail} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="info">
                            <span className="inline-flex items-center gap-1">
                              <MercadoLivreLogo size={14} />
                              Referencia Mercado Livre
                            </span>
                          </Badge>
                          <Badge tone="warning">DRAFT local</Badge>
                          {referenceImport.categoryId ? <Badge tone="muted">{referenceImport.categoryId}</Badge> : null}
                        </div>
                        <p className="mt-1 font-semibold text-matrix-fg">{formatValue(referenceImport.title)}</p>
                        <div className="mt-2 grid gap-1 text-sm text-matrix-muted sm:grid-cols-2">
                          <span>ID: {referenceImport.externalItemId}</span>
                          <span>Preco: {formatCurrency(referenceImport.price)}</span>
                          <span>GTIN: {formatValue(referenceImport.gtin)}</span>
                          <span>Marca: {formatValue(referenceImport.brand)}</span>
                          <span>Part number: {formatValue(referenceImport.partNumber)}</span>
                          <span>Categoria: {formatValue(referenceImport.categoryName ?? referenceImport.categoryId)}</span>
                        </div>
                        <p className="mt-2 text-xs text-matrix-muted">Origem: Referencia Mercado Livre importada por link/ID. Nada foi salvo no produto e nada foi publicado.</p>
                        {referenceImport.permalink ? (
                          <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-matrix-goldDark hover:text-matrix-gold" href={referenceImport.permalink} rel="noreferrer" target="_blank">
                            <MercadoLivreLogo size={14} />
                            Abrir anuncio
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
                {rankedMercadoLivreItems.length ? (
                  <div className="grid min-h-0 gap-4 p-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                    <div className="flex max-h-[calc(100vh-8rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-matrix-border bg-matrix-panel/72">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-matrix-border px-4 py-3">
                        <div>
                          <p className="flex items-center gap-2 font-semibold text-matrix-fg">
                            <MercadoLivreLogo size={18} />
                            Resultados do Mercado Livre
                          </p>
                          <p className="text-xs text-matrix-muted">Selecione um anuncio para ver os detalhes antes de usar como sugestao.</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-matrix-muted">
                          <Badge tone="info">
                            {mercadoLivreOfferCollectionInProgress
                              ? `${mercadoLivrePublicOfferResultCount} anuncio(s) com oferta encontrados`
                              : `${mercadoLivreOfferPageItems.length} anuncio(s) com oferta`}
                          </Badge>
                          {mercadoLivreCurrentPageDetailsTotal ? (
                            <Badge tone={mercadoLivreOfferCollectionInProgress ? "warning" : "success"}>
                              {mercadoLivreOfferCollectionInProgress
                                ? `Analisando ${mercadoLivreCurrentPageDetailsLoaded}/${mercadoLivreCurrentPageDetailsTotal} catalogo(s)`
                                : `Analise pronta ${mercadoLivreCurrentPageDetailsLoaded}/${mercadoLivreCurrentPageDetailsTotal}`}
                            </Badge>
                          ) : mercadoLivrePaging && mercadoLivrePageStart ? (
                            <Badge tone="muted">
                              Mostrando {mercadoLivrePageStart}-{mercadoLivrePageEnd} de {mercadoLivrePaging.total?.toLocaleString("pt-BR") ?? "muitos"}
                            </Badge>
                          ) : null}
                          {mercadoLivreOfferCollectionError ? <Badge tone="warning">{mercadoLivreOfferCollectionError}</Badge> : null}
                          {mercadoLivreOfferPageIncompleteFinal ? (
                            <Badge tone="warning">Foram encontrados {mercadoLivreOfferPageItems.length} anuncio(s) com oferta para esta pagina.</Badge>
                          ) : null}
                          <span className="rounded-md border border-matrix-border bg-matrix-panel2/70 px-2 py-1">
                            Pagina {mercadoLivreOfferPage}
                          </span>
                          <select
                            aria-label="Resultados Mercado Livre por pagina"
                            className="min-h-8 rounded-md border border-matrix-border bg-matrix-panel2 px-2 text-xs text-matrix-fg outline-none focus:border-matrix-gold"
                            onChange={(event) => changeMercadoLivrePageSize(event.target.value)}
                            value={String(mercadoLivrePageSize)}
                          >
                            <option value="10">10 por pagina</option>
                            <option value="20">20 por pagina</option>
                          </select>
                          <Button
                            className="min-h-8 px-2 py-1 text-xs"
                            disabled={mercadoLivreSearchLoading || !mercadoLivreOfferPageHasPrevious}
                            onClick={() => goToMercadoLivrePage(mercadoLivreOfferPage - 1)}
                            type="button"
                            variant="secondary"
                          >
                            Anterior
                          </Button>
                          <Button
                            className="min-h-8 px-2 py-1 text-xs"
                            disabled={mercadoLivreSearchLoading || !mercadoLivreOfferPageCanGoNext}
                            onClick={() => goToMercadoLivrePage(mercadoLivreOfferPage + 1)}
                            type="button"
                            variant="secondary"
                          >
                            Proxima
                          </Button>
                          <div ref={mercadoLivreFiltersRef} className="relative">
                            <Button
                              aria-expanded={mercadoLivreFiltersOpen}
                              className="min-h-8 px-2 py-1 text-xs"
                              onClick={() => setMercadoLivreFiltersOpen((current) => !current)}
                              type="button"
                              variant="secondary"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                              Filtros
                              {mercadoLivreActiveFilterCount ? (
                                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-matrix-gold px-1.5 text-[10px] font-bold text-black">
                                  {mercadoLivreActiveFilterCount}
                                </span>
                              ) : null}
                            </Button>
                            {mercadoLivreFiltersOpen ? (
                              <div className="absolute right-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-matrix-border bg-matrix-panel p-3 text-left shadow-glow">
                                <div className="mb-2 flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-matrix-goldDark">Filtros</p>
                                    <p className="mt-1 text-xs leading-5 text-matrix-muted">
                                      {filteredMercadoLivreItems.length} de {mercadoLivreOfferPageItems.length} anuncio(s) com oferta nesta pagina.
                                    </p>
                                  </div>
                                  {mercadoLivreActiveFilterCount ? (
                                    <span className="rounded-full bg-matrix-goldSoft px-2 py-0.5 text-[11px] font-semibold text-matrix-goldDark">
                                      {mercadoLivreActiveFilterCount} ativo(s)
                                    </span>
                                  ) : null}
                                </div>
                                <div className="grid gap-2">
                                  <button
                                    aria-pressed={!mercadoLivreHideIncompleteActive}
                                    className={`flex min-h-9 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs font-semibold transition ${
                                      mercadoLivreHideIncompleteActive
                                        ? "border-matrix-gold bg-matrix-goldSoft text-matrix-goldDark"
                                        : "border-matrix-border bg-matrix-panel2/70 text-matrix-muted hover:border-matrix-gold/50 hover:text-matrix-fg"
                                    }`}
                                    onClick={() => toggleMercadoLivreLocalFilter("hideIncomplete")}
                                    type="button"
                                  >
                                    <span>{mercadoLivreHideIncompleteActive ? "Mostrar incompletos" : "Ocultar incompletos"}</span>
                                    {mercadoLivreHideIncompleteActive ? <span className="text-[10px] uppercase tracking-wide">ativo</span> : null}
                                  </button>
                                  {mercadoLivreLocalFilterOptions.map((filter) => {
                                    const active = mercadoLivreLocalFilters.has(filter);
                                    return (
                                      <button
                                        key={filter}
                                        aria-pressed={active}
                                        className={`flex min-h-9 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs font-semibold transition ${
                                          active
                                            ? "border-matrix-gold bg-matrix-goldSoft text-matrix-goldDark"
                                            : "border-matrix-border bg-matrix-panel2/70 text-matrix-muted hover:border-matrix-gold/50 hover:text-matrix-fg"
                                        }`}
                                        onClick={() => toggleMercadoLivreLocalFilter(filter)}
                                        type="button"
                                      >
                                        <span>{mercadoLivreLocalFilterLabels[filter]}</span>
                                        {active ? <span className="text-[10px] uppercase tracking-wide">ativo</span> : null}
                                      </button>
                                    );
                                  })}
                                  <button
                                    className="mt-1 min-h-9 rounded-md border border-matrix-border bg-transparent px-3 py-2 text-left text-xs font-semibold text-matrix-muted transition hover:border-matrix-gold/50 hover:text-matrix-fg"
                                    onClick={() => setMercadoLivreLocalFilters(new Set<MercadoLivreLocalFilter>())}
                                    type="button"
                                  >
                                    Limpar filtros
                                  </button>
                                </div>
                                <p className="mt-3 text-xs leading-5 text-matrix-muted">
                                  {mercadoLivreOfferCollectionInProgress
                                    ? `Buscando anuncios com oferta: ${mercadoLivrePublicOfferResultCount} encontrado(s), ${mercadoLivreCurrentPageDetailsLoaded} de ${mercadoLivreCurrentPageDetailsTotal} catalogo(s) analisado(s), ${mercadoLivreCurrentPageDetailsLoading} em andamento, ${mercadoLivreCurrentPageDetailsPending} aguardando e ${mercadoLivreCurrentPageDetailsFailed} sem detalhe util.`
                                    : mercadoLivreHideIncompleteActive
                                    ? `Mostrando ${Math.min(mercadoLivreUsefulResultCount, filteredMercadoLivreItems.length)} anuncio(s) com dados uteis. ${mercadoLivreHiddenIncompleteCount} resultado(s) incompleto(s) foram ocultados. ${mercadoLivreAnalyzedResultCount} resultado(s) analisado(s).`
                                    : `Exibindo somente anuncios com oferta. ${mercadoLivrePublicOfferResultCount} oferta(s) encontrada(s) em ${mercadoLivreAnalyzedResultCount} catalogo(s) analisado(s).`}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="matrix-scroll min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-3">
                        {filteredMercadoLivreItems.length ? filteredMercadoLivreItems.map(({ item, compatibility: itemCompatibility, rankedIndex }) => {
                          const itemKey = mercadoLivreItemKey(item, rankedIndex);
                          const detailKey = mercadoLivreDetailCacheKey(item);
                          const isSelected = itemKey === selectedMercadoLivreResultKeyForRender;
                          const isDetailLoading = Boolean(detailKey && loadingMercadoLivreDetailsById[detailKey]);
                          const detailError = detailKey ? mercadoLivreDetailErrorsById[detailKey] : null;
                          const seller = mercadoLivreSellerLabel(item);
                          const reputation = mercadoLivreReputationLabel(item);
                          const sales = mercadoLivreSalesLabel(item);
                          const location = mercadoLivreLocationLabel(item);
                          const condition = mercadoLivreConditionLabel(item);
                          const listingType = mercadoLivreListingTypeLabel(item);
                          const category = mercadoLivreCategoryLabel(item);
                          const itemUrl = mercadoLivreItemPublicUrl(item);
                          const dataCompleteness = mercadoLivreDataCompleteness(item);
                          const itemTitle = item.title?.trim() || item.externalItemId || "Resultado Mercado Livre";
                          const hasPrice = typeof item.price === "number";
                          const showLeftMeta = Boolean(seller || reputation || sales);
                          const showRightMeta = Boolean(condition || location || item.externalItemId);

                          return (
                            <div
                              key={itemKey}
                              aria-label={`Selecionar anuncio ${item.externalItemId ?? itemTitle}`}
                              className={`h-auto min-h-fit cursor-pointer rounded-lg border px-3 py-2 transition ${
                                isSelected
                                  ? "border-matrix-gold bg-matrix-goldSoft/20 shadow-glow"
                                  : "border-matrix-border bg-matrix-panel2/72 hover:border-matrix-gold/45 hover:bg-matrix-goldSoft/10"
                              }`}
                              onClick={() => void selectMercadoLivreResult(item, rankedIndex)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  void selectMercadoLivreResult(item, rankedIndex);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <div className="grid grid-cols-[20px_56px_minmax(0,1fr)] gap-2.5">
                                <span className="mt-5 flex h-4 w-4 items-center justify-center rounded-full border border-matrix-border bg-matrix-panel2">
                                  {isSelected ? <span className="h-2 w-2 rounded-full bg-matrix-gold" /> : null}
                                </span>
                                <ProductImage alt={itemTitle} size="sm" src={item.imageUrl} />
                                <div className="min-w-0">
                                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
                                    <span className={compactBadgeClass("warning")}>MLB</span>
                                    <p className="line-clamp-1 min-w-0 text-sm font-semibold leading-snug text-matrix-fg">{itemTitle}</p>
                                  </div>
                                  {item.gtin ? <p className="mt-1 text-xs text-matrix-muted">GTIN: {item.gtin}</p> : null}
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    {hasPrice ? <span className="text-base font-semibold text-matrix-fg">{formatCurrency(item.price)}</span> : <span className={compactBadgeClass("muted")}>Sem preco publico</span>}
                                    <span className={compactBadgeClass("info")}>
                                      <MercadoLivreLogo size={12} />
                                      ML
                                    </span>
                                    {isDetailLoading ? <span className={compactBadgeClass("warning")}>Carregando detalhes...</span> : null}
                                    {detailError ? <span className={compactBadgeClass("danger")}>Detalhes indisponiveis</span> : null}
                                    <span className={compactBadgeClass(dataCompleteness.tone)}>{dataCompleteness.label}</span>
                                    {itemCompatibility ? <span className={compactBadgeClass(compatibilityTone(itemCompatibility.level))}>{itemCompatibility.label}</span> : null}
                                    {listingType ? <span className={compactBadgeClass(listingType === "Premium" ? "success" : listingType === "Clássico" || listingType === "Classico" ? "info" : "muted")}>{listingType}</span> : null}
                                  </div>
                                  {category ? <p className="mt-1 truncate text-[11px] leading-4 text-matrix-muted">Categoria: {category}</p> : null}
                                  {showLeftMeta || showRightMeta ? (
                                    <div className="mt-1.5 grid min-w-0 gap-x-3 gap-y-0.5 text-[11px] leading-4 text-matrix-muted sm:grid-cols-2">
                                      {showLeftMeta ? (
                                        <div className="min-w-0 space-y-0.5">
                                          {seller ? <p className="truncate">Vendedor: {seller}</p> : null}
                                          {reputation ? <p className="truncate">Reputacao: {reputation}</p> : null}
                                          {sales ? <p className="truncate">Vendas: {sales}</p> : null}
                                        </div>
                                      ) : null}
                                      {showRightMeta ? (
                                        <div className="min-w-0 space-y-0.5">
                                          {condition ? <p className="truncate">Estado: {condition}</p> : null}
                                          {location ? <p className="truncate">Localizacao: {location}</p> : null}
                                          {itemUrl && item.externalItemId ? (
                                            <a
                                              className="block truncate font-semibold text-matrix-goldDark hover:text-matrix-gold"
                                              href={itemUrl}
                                              onClick={(event) => event.stopPropagation()}
                                              rel="noopener noreferrer"
                                              target="_blank"
                                            >
                                              Anuncio: {item.externalItemId}
                                            </a>
                                          ) : item.externalItemId ? (
                                            <p className="truncate">Anuncio: {item.externalItemId}</p>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        }) : (
                          <div className="rounded-lg border border-dashed border-matrix-border bg-matrix-panel2/50 p-5 text-sm text-matrix-muted">
                            {mercadoLivreOfferCollectionInProgress
                              ? "Buscando anuncios com oferta para esta pagina. Os resultados aparecem assim que forem encontrados."
                              : mercadoLivreOfferPageItems.length
                                ? "Nenhum anuncio com oferta nesta pagina corresponde aos filtros. Limpe os filtros ou avance a pagina."
                                : "Foram encontrados poucos anuncios com oferta para esta pagina. Tente ajustar o termo de busca ou avance se houver mais resultados."}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-matrix-border bg-matrix-panel/78 xl:sticky xl:top-4 xl:self-start">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-matrix-border px-4 py-3">
                        <div>
                          <p className="font-semibold text-matrix-fg">Detalhes do anuncio selecionado</p>
                          <p className="text-xs text-matrix-muted">Revise as informacoes antes de carregar a sugestao para comparacao.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedMercadoLivreDataCompleteness ? (
                            <Badge tone={selectedMercadoLivreDataCompleteness.tone}>{selectedMercadoLivreDataCompleteness.label}</Badge>
                          ) : null}
                          {selectedMercadoLivreResultCompatibility ? (
                            <Badge tone={compatibilityTone(selectedMercadoLivreResultCompatibility.level)}>{selectedMercadoLivreResultCompatibility.label}</Badge>
                          ) : (
                            <Badge tone="muted">Revisao manual</Badge>
                          )}
                          {selectedMercadoLivreDetailListingType ? (
                            <Badge tone={selectedMercadoLivreDetailListingType === "Premium" ? "success" : selectedMercadoLivreDetailListingType === "Clássico" || selectedMercadoLivreDetailListingType === "Classico" ? "info" : "muted"}>
                              {selectedMercadoLivreDetailListingType}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      {selectedMercadoLivreDetailItem ? (
                        <div className="matrix-scroll max-h-[calc(100vh-8rem)] overflow-x-hidden overflow-y-auto p-3 md:p-4">
                          {selectedMercadoLivreDetailLoading ? (
                            <div className="mb-4 rounded-md border border-matrix-gold/35 bg-matrix-goldSoft/18 px-3 py-2 text-xs text-matrix-muted">
                              Carregando detalhes completos deste anuncio em segundo plano. A lista basica ja esta disponivel para revisao.
                            </div>
                          ) : null}
                          {selectedMercadoLivreDetailError ? (
                            <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                              {selectedMercadoLivreDetailError}
                            </div>
                          ) : null}
                          <div className="grid gap-4 lg:grid-cols-[minmax(180px,260px)_minmax(0,1fr)]">
                            <MercadoLivreImageGallery
                              item={selectedMercadoLivreDetailItem}
                              alt={selectedMercadoLivreDetailItem.title?.trim() || selectedMercadoLivreDetailItem.externalItemId || "Anuncio Mercado Livre"}
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone="info">
                                  <span className="inline-flex items-center gap-1">
                                    <MercadoLivreLogo size={14} />
                                    Mercado Livre
                                  </span>
                                </Badge>
                                {selectedMercadoLivreDetailItem.categoryId ? <Badge tone="muted">{selectedMercadoLivreDetailItem.categoryId}</Badge> : null}
                              </div>
                              <h5 className="mt-3 text-lg font-semibold text-matrix-fg">{selectedMercadoLivreDetailItem.title?.trim() || selectedMercadoLivreDetailItem.externalItemId || "Anuncio Mercado Livre"}</h5>
                              {typeof selectedMercadoLivreDetailItem.price === "number" ? (
                                <p className="mt-3 text-2xl font-semibold text-matrix-fg">{formatCurrency(selectedMercadoLivreDetailItem.price)}</p>
                              ) : null}
                              <div className="mt-3 grid gap-2 text-sm text-matrix-muted sm:grid-cols-2">
                                {selectedMercadoLivreDetailItem.gtin ? <span>GTIN/EAN: {selectedMercadoLivreDetailItem.gtin}</span> : null}
                                {selectedMercadoLivreDetailCondition ? <span>Status/condicao: {selectedMercadoLivreDetailCondition}</span> : null}
                                {selectedMercadoLivreDetailItem.brand ? <span>Marca: {selectedMercadoLivreDetailItem.brand}</span> : null}
                                {selectedMercadoLivreDetailItem.sku ? <span>SKU: {selectedMercadoLivreDetailItem.sku}</span> : null}
                                {selectedMercadoLivreDetailSeller ? <span>Vendedor: {selectedMercadoLivreDetailSeller}</span> : null}
                                {selectedMercadoLivreDetailReputation ? <span>Reputacao: {selectedMercadoLivreDetailReputation}</span> : null}
                                {selectedMercadoLivreDetailSales ? <span>Vendas: {selectedMercadoLivreDetailSales}</span> : null}
                                {selectedMercadoLivreDetailListingType ? <span>Tipo: {selectedMercadoLivreDetailListingType}</span> : null}
                                {selectedMercadoLivreDetailLocation ? <span>Localizacao: {selectedMercadoLivreDetailLocation}</span> : null}
                                <span>Fonte: {mercadoLivreSourceLabel(selectedMercadoLivreDetailItem.source)}</span>
                              </div>
                              {selectedMercadoLivreDataCompleteness?.label !== "Dados completos" ? (
                                <p className="mt-3 rounded-md border border-matrix-border bg-matrix-panel2/60 px-3 py-2 text-xs text-matrix-muted">
                                  {mercadoLivreIncompleteNotice(selectedMercadoLivreDetailItem)}
                                </p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                                {selectedMercadoLivreDetailUrl && selectedMercadoLivreDetailItem.externalItemId ? (
                                  <a
                                    className="inline-flex items-center gap-1 font-semibold text-matrix-goldDark hover:text-matrix-gold"
                                    href={selectedMercadoLivreDetailUrl}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    Anuncio {selectedMercadoLivreDetailItem.externalItemId}
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : selectedMercadoLivreDetailItem.externalItemId ? (
                                  <span className="text-matrix-muted">Anuncio: {selectedMercadoLivreDetailItem.externalItemId}</span>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {selectedMercadoLivreDetailCategory || selectedMercadoLivreDetailItem.categoryId ? (
                            <div className="mt-4 rounded-lg border border-matrix-border bg-matrix-panel2/62 p-3">
                              <p className="font-semibold text-matrix-fg">Categoria no Mercado Livre</p>
                              {selectedMercadoLivreDetailCategory ? <p className="mt-2 text-sm text-matrix-muted">{selectedMercadoLivreDetailCategory}</p> : null}
                              {selectedMercadoLivreDetailItem.categoryId ? <p className="mt-1 text-xs text-matrix-muted">CategoryId: {selectedMercadoLivreDetailItem.categoryId}</p> : null}
                            </div>
                          ) : null}

                          <div className="mt-4 rounded-lg border border-matrix-border bg-matrix-panel2/62 p-3">
                            <p className="font-semibold text-matrix-fg">Variacoes / Atributos</p>
                            {selectedMercadoLivreDetailAttributes.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {selectedMercadoLivreDetailAttributes.map((attribute, attributeIndex) => (
                                  <span key={`${attribute.id ?? attribute.name ?? "atributo"}-${attributeIndex}`} className="rounded-md border border-matrix-border bg-matrix-panel px-2 py-1 text-xs text-matrix-muted">
                                    {attribute.name ?? attribute.id}: <span className="text-matrix-fg">{attribute.value}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-matrix-muted">Nenhum atributo adicional retornado nesta consulta read-only.</p>
                            )}
                          </div>

                          {selectedMercadoLivreResultCompatibility ? (
                            <CompatibilityDetails compatibility={selectedMercadoLivreResultCompatibility} localProduct={product} />
                          ) : null}

                          <div className="mt-4 grid gap-3 rounded-lg border border-matrix-border bg-matrix-panel2/62 p-3 md:grid-cols-[minmax(0,1fr)_220px]">
                            <div>
                              <p className="font-semibold text-matrix-fg">Acoes disponiveis</p>
                              <p className="mt-1 text-xs text-matrix-muted">Essas acoes carregam a comparacao local. Nada e salvo automaticamente.</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button onClick={() => selectMercadoLivreSuggestion(selectedMercadoLivreDetailItem)} type="button">
                                  Usar como sugestao
                                </Button>
                                <Button onClick={() => selectMercadoLivreSuggestion(selectedMercadoLivreDetailItem)} type="button" variant="secondary">
                                  Comparar com produto atual
                                </Button>
                                {selectedMercadoLivreDetailUrl ? (
                                  <a
                                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
                                    href={selectedMercadoLivreDetailUrl}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Abrir anuncio
                                  </a>
                                ) : null}
                              </div>
                            </div>
                            <div className="rounded-md border border-matrix-border bg-matrix-panel p-3">
                              <p className="font-semibold text-matrix-fg">Confianca</p>
                              <p className="mt-1 text-sm text-matrix-muted">{selectedMercadoLivreResultCompatibility?.score !== null && selectedMercadoLivreResultCompatibility?.score !== undefined ? `${selectedMercadoLivreResultCompatibility.score}/100` : "Sem score"}</p>
                              <p className="mt-2 text-xs text-matrix-muted">
                                {selectedMercadoLivreResultCompatibility?.level === "LOW"
                                  ? "Baixa compatibilidade exige confirmacao extra antes de salvar."
                                  : "Revise os campos antes de salvar localmente."}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid min-h-64 place-items-center p-6 text-center text-sm text-matrix-muted">
                          Selecione um resultado na lista para ver os detalhes.
                        </div>
                      )}
                    </div>
                  </div>
                ) : mercadoLivreSearch ? (
                  <div className="px-4 py-5 text-sm text-matrix-muted">
                    {mercadoLivreGtinCatalogEmpty ? (
                      <div className="mx-auto max-w-2xl rounded-lg border border-matrix-gold/35 bg-matrix-goldSoft/18 p-5 text-left shadow-glow">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-matrix-gold/45 bg-matrix-goldSoft/40 text-matrix-goldDark">
                            <Search className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-semibold text-matrix-fg">Nenhum resultado por GTIN/EAN</p>
                            <p className="mt-2 text-sm leading-relaxed text-matrix-muted">
                              O Catálogo Mercado Livre não retornou produto para o GTIN/EAN {formatValue(mercadoLivreCopyGtinValue)}. Você pode tentar buscar pelo título do produto.
                            </p>
                            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                              <Button
                                className="justify-center"
                                disabled={mercadoLivreSearchLoading || !selectedProductName?.trim()}
                                onClick={() => searchMercadoLivreReadOnly("title")}
                                type="button"
                              >
                                <MercadoLivreLogo size={18} />
                                Buscar por título
                              </Button>
                              {mercadoLivreGtinManualSearchUrl ? (
                                <a
                                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-matrix-border bg-matrix-panel2/80 px-3 py-2 text-sm font-semibold text-matrix-fg transition hover:border-matrix-gold/50 hover:bg-matrix-goldSoft/40"
                                  href={mercadoLivreGtinManualSearchUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  Abrir busca no site por GTIN
                                </a>
                              ) : null}
                              <Button disabled={!mercadoLivreCopyGtinValue} onClick={() => copyText(mercadoLivreCopyGtinValue, "GTIN")} type="button" variant="secondary">
                                <Copy className="h-4 w-4" />
                                Copiar GTIN
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : mercadoLivreNotice ? (
                      <p>Nenhum resultado de anuncio foi exibido nesta consulta manual.</p>
                    ) : (
                      <p>Nenhum resultado Mercado Livre encontrado para esta busca. Tente buscar pelo titulo ou ajuste o termo.</p>
                    )}
                  </div>
                ) : null}
              </section>
            ) : null}

          </div>
        </main>
      </div>

      {activePanel ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-0 sm:p-4">
          <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden border border-matrix-gold/40 bg-matrix-panel shadow-glow sm:h-[min(94dvh,960px)] sm:rounded-lg">
            <div className="flex items-start justify-between gap-3 border-b border-matrix-border px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <WandSparkles className="mt-1 h-5 w-5 shrink-0 text-matrix-gold" />
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-matrix-fg">
                    {activePanel === "extracted" ? "Cadastro inteligente" : auxiliaryPanelTitle}
                  </h3>
                  <p className="mt-1 text-sm text-matrix-muted">
                    {activePanel === "extracted"
                      ? "Revise as informações e salve o produto."
                      : "Informações locais para revisão."}
                  </p>
                </div>
              </div>
              <button
                aria-label="Fechar"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-matrix-border bg-matrix-panel2 text-matrix-muted transition hover:border-matrix-gold/50 hover:text-matrix-fg"
                onClick={activePanel === "extracted" ? closeProductPreview : () => setActivePanel(null)}
                title="Fechar"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className={`min-h-0 flex-1 overflow-x-hidden p-4 sm:p-6 ${activePanel === "extracted" ? "overflow-hidden" : "matrix-scroll overflow-y-auto"}`}>
              {activePanel === "product" ? productPanelContent : activePanel === "extracted" ? extractedPanelContent : historyPanelContent}
            </div>
          </div>
        </div>
      ) : null}

      {referenceImportOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-matrix-border bg-matrix-panel p-5 shadow-glow">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-matrix-goldDark">
                  <MercadoLivreLogo size={16} />
                  Mercado Livre
                </p>
                <h3 className="mt-1 text-xl font-semibold text-matrix-fg">Importar referencia Mercado Livre</h3>
                <p className="mt-1 text-sm text-matrix-muted">Cole o link ou ID do anuncio. A consulta e read-only e cria apenas um DRAFT local para revisao.</p>
              </div>
              <Button onClick={() => setReferenceImportOpen(false)} type="button" variant="secondary">
                Cancelar
              </Button>
            </div>

            <label className="mt-5 block text-sm font-semibold text-matrix-fg">
              Cole o link ou ID do anuncio Mercado Livre
              <input
                className="mt-2 w-full rounded-md border border-matrix-border bg-matrix-panel2 px-3 py-2 text-sm text-matrix-fg outline-none focus:border-matrix-gold/60"
                onChange={(event) => {
                  setReferenceImportInput(event.target.value);
                  setReferenceImportError(null);
                  setReferenceImportErrorDetails(null);
                }}
                placeholder="MLB1234567890 ou https://produto.mercadolivre.com.br/MLB-1234567890..."
                value={referenceImportInput}
              />
            </label>

            {referenceImportError ? (
              <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                <p className="font-semibold">{referenceImportError}</p>
                {referenceImportErrorDetails?.normalizedItemId || referenceImportErrorDetails?.diagnostic ? (
                  <div className="mt-3 space-y-1 text-xs text-red-100/90">
                    {referenceImportErrorDetails.normalizedItemId ? <p>ID identificado: {referenceImportErrorDetails.normalizedItemId}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.status ? <p>Status da consulta: {referenceImportErrorDetails.diagnostic.status}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.endpoint ? <p>Endpoint: {referenceImportErrorDetails.diagnostic.endpoint}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.errorCode ? <p>Codigo: {referenceImportErrorDetails.diagnostic.errorCode}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.errorMessage ? <p>Mensagem ML: {referenceImportErrorDetails.diagnostic.errorMessage}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.requestId ? <p>RequestId: {referenceImportErrorDetails.diagnostic.requestId}</p> : null}
                    {referenceImportErrorDetails.diagnostic?.correlationId ? <p>CorrelationId: {referenceImportErrorDetails.diagnostic.correlationId}</p> : null}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {referenceImportErrorDetails?.originalUrl ? (
                    <a
                      className="inline-flex items-center gap-2 rounded-md border border-red-400/35 px-3 py-2 text-xs font-semibold text-red-50 transition hover:border-red-200"
                      href={referenceImportErrorDetails.originalUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <MercadoLivreLogo size={14} />
                      Abrir anuncio no Mercado Livre
                    </a>
                  ) : null}
                  <Button
                    onClick={() => {
                      setReferenceImportInput("");
                      setReferenceImportError(null);
                      setReferenceImportErrorDetails(null);
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Tentar outro link/ID
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-md border border-matrix-border bg-matrix-panel2/58 p-3 text-xs text-matrix-muted">
              Aceita formatos como MLB1234567890, MLB-1234567890 e links do mercadolivre.com.br que contenham um ID MLB valido.
              Nenhum Product sera alterado e nada sera publicado.
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button onClick={() => setReferenceImportOpen(false)} type="button" variant="secondary">
                Fechar
              </Button>
              <Button disabled={referenceImportLoading} onClick={importMercadoLivreReference} type="button">
                {referenceImportLoading ? "Importando..." : "Importar referencia"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
