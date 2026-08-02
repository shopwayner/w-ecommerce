import { createHash } from "node:crypto";
import {
  ERPProvider,
  Prisma,
  ProductCommercialStatus,
  ProductCondition,
  ProductDimensionUnit,
  ProductFormat,
  ProductProductionType,
  ProductType
} from "@prisma/client";
import {
  BlingImportPreviewError,
  collectBlingPreviewPages,
  evaluateBlingImportPreviewIntegrity,
  validateBlingImportPreviewProof,
  type BlingImportTotalSource,
  type BlingImportPreviewFailureDiagnostic
} from "@/lib/bling-product-import-preview";
import {
  appendBlingProductSyncFailure,
  appendBlingProductSyncReport,
  createBlingSyncReportNotificationMarker,
  emptyBlingProductSyncReport,
  hasMeaningfulSyncChange,
  type BlingProductSyncChange,
  type BlingProductSyncReport,
  type BlingProductSyncReportItem
} from "@/lib/bling-product-sync-report";
import { prisma } from "@/lib/prisma";
import {
  extractBlingProductBrand,
  normalizeProductBrand,
  resolveProductBrandFromBling
} from "@/lib/product-brand";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";
import {
  normalizeBlingProductImages,
  readBlingProductImageUrls
} from "@/lib/services/bling-product-update-service";
import {
  BlingErpConnectionCompatibilityError,
  ensureOrganizationBlingErpConnection
} from "@/lib/services/bling-erp-connection-compatibility-service";
import {
  normalizeBlingDimensionUnit,
  normalizeBlingProductCondition
} from "@/lib/services/bling-product-details-enrichment";
import {
  isValidGtin,
  normalizeGtin
} from "@/lib/services/internal-gtin-catalog-service";

const pageSize = 100;
const maxSafetyPages = 1_000;
const maxRetryAttempts = 3;
const staleJobLeaseMs = 5 * 60 * 1_000;
const previewConfirmationLifetimeMs = 10 * 60 * 1_000;
const previewPageTimeoutMs = 30_000;
const jobTypeByOperation = {
  IMPORT: "BLING_PRODUCTS_IMPORT",
  SYNC: "BLING_PRODUCTS_SYNC"
} as const;
const previewJobTypeByOperation = {
  IMPORT: "BLING_PRODUCTS_PREVIEW_IMPORT",
  SYNC: "BLING_PRODUCTS_PREVIEW_SYNC"
} as const;
const previewJobTypes = Object.values(previewJobTypeByOperation);

type JsonRecord = Record<string, unknown>;
export type BlingProductJobOperation = keyof typeof jobTypeByOperation;

export type BlingPreviewJobProgress = {
  stage: "PENDING" | "CATALOG_PAGE" | "LOCAL_COMPARISON" | "COMPLETED";
  currentPage: number;
  pagesCompleted: number;
  itemsProcessed: number;
  totalItems: number | null;
  uniqueProducts: number;
  duplicateCount: number;
  invalidCount: number;
  withChanges: number;
  withoutChanges: number;
  failures: number;
  heartbeatAt: string;
  processedExternalIds?: string[];
};

export type BlingProductPreviewJobCursor = {
  version: 1;
  kind: "BLING_PRODUCT_PREVIEW";
  operation: BlingProductJobOperation;
  userId: string;
  correlationId: string;
  progress: BlingPreviewJobProgress;
  preview?: BlingProductDryRun;
  errorCode?: string;
};

export function parseBlingProductPreviewJobCursor(
  value: string | null | undefined
): BlingProductPreviewJobCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BlingProductPreviewJobCursor>;
    if (
      parsed.version !== 1
      || parsed.kind !== "BLING_PRODUCT_PREVIEW"
      || !["IMPORT", "SYNC"].includes(parsed.operation ?? "")
      || typeof parsed.userId !== "string"
      || typeof parsed.correlationId !== "string"
      || !parsed.progress
    ) return null;
    return parsed as BlingProductPreviewJobCursor;
  } catch {
    return null;
  }
}

export function previewJobType(operation: BlingProductJobOperation) {
  return previewJobTypeByOperation[operation];
}

export function isPreviewJobType(type: string) {
  return previewJobTypes.includes(type as (typeof previewJobTypes)[number]);
}

type BlingCatalogResponse = {
  data?: unknown;
  meta?: unknown;
  pagination?: unknown;
  total?: unknown;
};

export type NormalizedBlingStoreLink = {
  linkId: string;
  storeId: string;
  storeName: string | null;
  provider: "MERCADO_LIVRE" | null;
  externalListingId: string | null;
  status: string | null;
  url: string | null;
};

export type NormalizedBlingProduct = {
  externalProductId: string;
  parentExternalProductId: string | null;
  name: string;
  sku: string | null;
  gtin: string | null;
  packagingGtin: string | null;
  description: string | null;
  shortDescription: string | null;
  price: number | null;
  costPrice: number | null;
  stock: number | null;
  unit: string | null;
  imageUrl: string | null;
  images: string[];
  brand: string | null;
  category: string | null;
  categoryId: string | null;
  ncm: string | null;
  weight: number | null;
  grossWeight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  dimensionUnit: ProductDimensionUnit | null;
  condition: ProductCondition | null;
  status: string;
  format: ProductFormat | null;
  productType: ProductType | null;
  commercialStatus: ProductCommercialStatus | null;
  productionType: ProductProductionType | null;
  expirationDate: Date | null;
  freeShipping: boolean | null;
  volumes: number | null;
  itemsPerBox: number | null;
  origin: string | null;
  storeLinks: NormalizedBlingStoreLink[];
  storeLinksComplete: boolean;
  isVariation: boolean;
};

export type BlingProductImportItemStatus =
  | "CREATED"
  | "UPDATED"
  | "LINKED_BY_SKU"
  | "LINKED_BY_GTIN"
  | "NO_CHANGES"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "FAILED";

export type BlingProductImportMatchKind =
  | "MAPPING"
  | "SKU"
  | "GTIN"
  | "CREATE"
  | "NEEDS_REVIEW";

export type BlingProductImportMatch = {
  kind: BlingProductImportMatchKind;
  productId: string | null;
  conflictField: "SKU" | "GTIN" | null;
};

type ProductIdentityCandidate = {
  id: string;
};

export function resolveBlingProductImportMatch(input: {
  mappedProductId?: string | null;
  sku: string | null;
  gtin: string | null;
  skuCandidates?: ProductIdentityCandidate[];
  gtinCandidates?: ProductIdentityCandidate[];
}): BlingProductImportMatch {
  if (input.mappedProductId) {
    return { kind: "MAPPING", productId: input.mappedProductId, conflictField: null };
  }

  const sku = input.sku?.trim() || null;
  const skuCandidates = sku ? input.skuCandidates ?? [] : [];
  if (skuCandidates.length > 1) {
    return { kind: "NEEDS_REVIEW", productId: null, conflictField: "SKU" };
  }
  if (skuCandidates.length === 1) {
    return { kind: "SKU", productId: skuCandidates[0].id, conflictField: null };
  }

  const gtin = normalizeGtin(input.gtin);
  const gtinCandidates = gtin && isValidGtin(gtin) ? input.gtinCandidates ?? [] : [];
  if (gtinCandidates.length > 1) {
    return { kind: "NEEDS_REVIEW", productId: null, conflictField: "GTIN" };
  }
  if (gtinCandidates.length === 1) {
    return { kind: "GTIN", productId: gtinCandidates[0].id, conflictField: null };
  }

  return { kind: "CREATE", productId: null, conflictField: null };
}

export async function processBlingImportItemsIndependently<T, TState>(input: {
  items: T[];
  initialState: TState;
  processItem: (item: T, state: TState) => Promise<TState>;
  recordFailure: (item: T, state: TState, error: unknown) => Promise<TState>;
}) {
  let state = input.initialState;
  for (const item of input.items) {
    try {
      state = await input.processItem(item, state);
    } catch (error) {
      state = await input.recordFailure(item, state, error);
    }
  }
  return state;
}

type BlingProductImportMatchSummary = {
  updatedByMapping: number;
  linkedBySku: number;
  linkedByGtin: number;
  created: number;
  needsReview: number;
  skuConflicts: number;
  gtinConflicts: number;
};

type BlingProductImportProgress = {
  processed: number;
  created: number;
  updated: number;
  linkedBySku: number;
  linkedByGtin: number;
  noChanges: number;
  needsReview: number;
  invalid: number;
  failed: number;
};

type BlingProductImportJobCursor = {
  version: 2;
  operation: BlingProductJobOperation;
  automatic: boolean;
  preview: {
    total: number;
    pageCounts: number[];
    summary: BlingProductImportMatchSummary;
    invalid: number;
    reportedTotal: number | null;
    sourceRows: number;
    listFingerprint?: string;
  };
  progress: BlingProductImportProgress;
  page: number;
  itemIndex: number;
  invalidRowsRecorded: boolean;
  syncReport?: BlingProductSyncReport;
};

function emptyImportProgress(): BlingProductImportProgress {
  return {
    processed: 0,
    created: 0,
    updated: 0,
    linkedBySku: 0,
    linkedByGtin: 0,
    noChanges: 0,
    needsReview: 0,
    invalid: 0,
    failed: 0
  };
}

export type CanonicalBlingProductStatus = "ACTIVE" | "INACTIVE" | "DELETED" | "UNKNOWN";

type NormalizedBlingProductStatus = {
  status: CanonicalBlingProductStatus;
  externalStatus: "A" | "I" | "E" | null;
};

export type BlingProductStatusBackfillReport = {
  mode: "DRY_RUN" | "CONFIRMED";
  catalogProductsFound: number;
  catalogPagesFound: number;
  linkedProducts: number;
  externalIdsLocated: number;
  active: number;
  inactive: number;
  deleted: number;
  unknown: number;
  divergences: number;
  recordsWouldChange: number;
  recordsAlreadyCorrect: number;
  linkedRecordsWithoutCatalogStatus: number;
  catalogRecordsWithoutLink: number;
  conflictingExternalIds: number;
  errors: number;
  completed: boolean;
  writesPerformed: number;
  concurrentUpdates: number;
  identityMismatches: number;
};

export type BlingProductStatusConditionalUpdateInput = {
  productId: string;
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  attributes: Prisma.JsonValue | null;
  updatedAt: Date;
  status: CanonicalBlingProductStatus;
  externalStatus: "A" | "I" | "E" | null;
  statusCheckedAt: string;
};

export type BlingProductDryRun = {
  operation: BlingProductJobOperation;
  connectionReady: true;
  connectionId: string;
  connectionName: string;
  correlationId: string;
  reportedTotal: number | null;
  derivedTotal: number | null;
  totalSource: BlingImportTotalSource;
  totalReportedByBling: number | null;
  totalFound: number;
  pagesFound: number;
  pagesCompleted: number;
  pagesExpected: number;
  pageSize: number;
  firstPage: number;
  lastDataPage: number;
  sentinelPage: number | null;
  pageCounts: number[];
  uniqueProductsLoaded: number;
  uniqueIdsCount: number;
  simpleProducts: number;
  variations: number;
  active: number;
  inactive: number;
  withoutSku: number;
  withoutGtin: number;
  existing: number;
  new: number;
  wouldUpdate: number;
  syncAnalyzed: number;
  syncWithChanges: number;
  syncWithoutChanges: number;
  syncFailures: number;
  importable: number;
  updatedByMapping: number;
  linkedBySku: number;
  linkedByGtin: number;
  wouldCreate: number;
  needsReview: number;
  invalid: number;
  errors: number;
  ignored: number;
  duplicateExternalIds: number;
  skuConflicts: number;
  gtinConflicts: number;
  completed: boolean;
  paginationComplete: true;
  previewComplete: true;
  listFingerprint: string;
  previewFingerprint: string;
  previewExpiresAt: string;
  confirmationToken: string;
  warnings: string[];
  durationMs: number;
  writesPerformed: false;
};

type BlingImportPreviewConfirmation = {
  version: 5;
  operation: "BLING_PRODUCT_IMPORT_PREVIEW";
  previewJobId: string;
  jobOperation: BlingProductJobOperation;
  userId: string;
  organizationId: string;
  connectionId: string;
  correlationId: string;
  pageSize: number;
  firstPage: number;
  lastDataPage: number;
  sentinelPage: number | null;
  pageCounts: number[];
  uniqueIdsCount: number;
  reportedTotal: number | null;
  derivedTotal: number | null;
  totalSource: BlingImportTotalSource;
  duplicateCount: number;
  invalidCount: number;
  listFingerprint: string;
  existing: number;
  newProducts: number;
  importable: number;
  skuConflicts: number;
  matchSummary: BlingProductImportMatchSummary;
  previewFingerprint: string;
  issuedAt: string;
  expiresAt: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown) {
  const parsed = numeric(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function positiveOrNull(value: unknown) {
  const parsed = numeric(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function emptyMatchSummary(): BlingProductImportMatchSummary {
  return {
    updatedByMapping: 0,
    linkedBySku: 0,
    linkedByGtin: 0,
    created: 0,
    needsReview: 0,
    skuConflicts: 0,
    gtinConflicts: 0
  };
}

function addMatchSummaries(
  left: BlingProductImportMatchSummary,
  right: BlingProductImportMatchSummary
) {
  return Object.fromEntries(
    Object.keys(left).map((key) => [
      key,
      left[key as keyof BlingProductImportMatchSummary]
        + right[key as keyof BlingProductImportMatchSummary]
    ])
  ) as BlingProductImportMatchSummary;
}

function booleanOrNull(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "sim", "s"].includes(normalized)) return true;
  if (["false", "0", "nao", "não", "n"].includes(normalized)) return false;
  return null;
}

function dateOrNull(value: unknown) {
  const normalized = text(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function productFormat(value: unknown, variation: boolean) {
  if (variation) return ProductFormat.VARIATION;
  const normalized = text(value).toUpperCase();
  if (["S", "SIMPLE"].includes(normalized)) return ProductFormat.SIMPLE;
  if (["V", "VARIATION", "VARIACAO"].includes(normalized)) return ProductFormat.VARIATION;
  if (["E", "COMPOSITION", "COMPOSICAO"].includes(normalized)) return ProductFormat.COMPOSITION;
  return null;
}

function productType(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (["P", "PRODUCT"].includes(normalized)) return ProductType.PRODUCT;
  if (["S", "SERVICE"].includes(normalized)) return ProductType.SERVICE;
  if (["N", "SERVICE_06_21_22"].includes(normalized)) return ProductType.SERVICE_06_21_22;
  return null;
}

function commercialStatus(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (["A", "ACTIVE"].includes(normalized)) return ProductCommercialStatus.ACTIVE;
  if (["I", "INACTIVE"].includes(normalized)) return ProductCommercialStatus.INACTIVE;
  return null;
}

function productionType(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (["P", "OWN"].includes(normalized)) return ProductProductionType.OWN;
  if (["T", "THIRD_PARTY"].includes(normalized)) return ProductProductionType.THIRD_PARTY;
  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const normalized = numeric(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function normalizeBlingProductStatus(value: unknown): NormalizedBlingProductStatus {
  const normalized = text(value).toUpperCase();
  if (normalized === "A" || normalized === "ACTIVE") return { status: "ACTIVE", externalStatus: "A" };
  if (normalized === "I" || normalized === "INACTIVE") return { status: "INACTIVE", externalStatus: "I" };
  if (normalized === "E" || normalized === "DELETED") return { status: "DELETED", externalStatus: "E" };
  return { status: "UNKNOWN", externalStatus: null };
}

export function readBlingProductConnectionAttributes(
  attributes: unknown,
  connectionId?: string | null
) {
  const bling = record(record(attributes).bling);
  if (!connectionId) return bling;
  const legacyValues = { ...bling };
  delete legacyValues.connections;
  const legacy =
    text(bling.connectionId) === connectionId ? legacyValues : {};
  const scoped = record(record(bling.connections)[connectionId]);
  if (Object.keys(scoped).length) return { ...legacy, ...scoped };
  return legacy;
}

export function readCanonicalBlingStatusFromAttributes(
  attributes: unknown,
  connectionId?: string | null
): CanonicalBlingProductStatus {
  const bling = readBlingProductConnectionAttributes(attributes, connectionId);
  const normalized = normalizeBlingProductStatus(bling.status);
  const externalStatus = text(bling.externalStatus).toUpperCase();
  const statusCheckedAt = text(bling.statusCheckedAt);
  const checkedAtTimestamp = statusCheckedAt ? Date.parse(statusCheckedAt) : Number.NaN;
  if (
    normalized.status === "UNKNOWN" ||
    normalized.externalStatus !== externalStatus ||
    !Number.isFinite(checkedAtTimestamp)
  ) {
    return "UNKNOWN";
  }
  return normalized.status;
}

function extractReportedTotal(payload: BlingCatalogResponse) {
  const meta = record(payload.meta);
  const metaPagination = record(meta.pagination);
  const pagination = record(payload.pagination);
  const supportedValues = [
    payload.total,
    meta.total,
    meta.totalRegistros,
    metaPagination.total,
    pagination.total
  ];
  const raw = supportedValues.find((value) =>
    value !== undefined && value !== null && value !== ""
  );
  if (raw === undefined) {
    return { reportedTotal: null, totalSource: "NONE" as const, totalInvalid: false };
  }
  const reportedTotal = numeric(raw);
  if (
    reportedTotal === null
    || !Number.isInteger(reportedTotal)
    || reportedTotal < 0
  ) {
    return { reportedTotal: null, totalSource: "RESPONSE" as const, totalInvalid: true };
  }
  return { reportedTotal, totalSource: "RESPONSE" as const, totalInvalid: false };
}

function normalizeOne(rawValue: unknown, parent?: NormalizedBlingProduct): NormalizedBlingProduct | null {
  const raw = record(rawValue);
  const externalProductId = firstText(raw.id, raw.idProduto, raw.externalId);
  const name = firstText(raw.nome, raw.descricao, parent?.name);
  if (!externalProductId || !name) return null;

  const stock = record(raw.estoque);
  const dimensions = record(raw.dimensoes);
  const media = record(raw.midia);
  const category = record(raw.categoria);
  const supplier = record(raw.fornecedor);
  const tax = record(raw.tributacao);
  const variation = Boolean(parent);
  const imageUrls = normalizeBlingProductImages([
    ...readBlingProductImageUrls(raw),
    parent?.imageUrl
  ]);

  return {
    externalProductId,
    parentExternalProductId: parent?.externalProductId ?? null,
    name,
    sku: firstText(raw.codigo, raw.sku),
    gtin: firstText(raw.gtin, raw.ean),
    packagingGtin: firstText(raw.gtinEmbalagem, raw.eanEmbalagem, parent?.packagingGtin),
    description: firstText(raw.descricaoComplementar, raw.descricaoCurta, parent?.description),
    shortDescription: firstText(raw.descricaoCurta, parent?.shortDescription),
    price: positiveOrNull(raw.preco),
    costPrice: firstNumber(raw.precoCusto, supplier.precoCusto),
    stock: integer(stock.saldoVirtualTotal ?? stock.saldoFisicoTotal ?? stock.saldo ?? raw.estoqueAtual),
    unit: firstText(raw.unidade, parent?.unit),
    imageUrl: imageUrls[0] ?? firstText(media.imagemURL, media.imagemUrl, raw.imagemURL, raw.imagemUrl, parent?.imageUrl),
    images: imageUrls,
    brand: extractBlingProductBrand(raw) ?? parent?.brand ?? null,
    category: firstText(category.descricao, category.nome, raw.categoriaNome, parent?.category),
    categoryId: firstText(category.id, raw.idCategoria, parent?.categoryId),
    ncm: firstText(tax.ncm, raw.ncm, parent?.ncm),
    weight: firstNumber(raw.pesoLiquido, dimensions.peso, parent?.weight),
    grossWeight: firstNumber(raw.pesoBruto, parent?.grossWeight),
    height: firstNumber(dimensions.altura, raw.altura, parent?.height),
    width: firstNumber(dimensions.largura, raw.largura, parent?.width),
    depth: firstNumber(dimensions.profundidade, raw.profundidade, raw.comprimento, parent?.depth),
    dimensionUnit: normalizeBlingDimensionUnit(dimensions.unidadeMedida) as ProductDimensionUnit | null
      ?? parent?.dimensionUnit
      ?? null,
    condition: normalizeBlingProductCondition(raw.condicao) as ProductCondition | null
      ?? parent?.condition
      ?? null,
    status: firstText(raw.situacao, parent?.status) ?? "UNKNOWN",
    format: productFormat(raw.formato, variation) ?? parent?.format ?? null,
    productType: productType(raw.tipo) ?? parent?.productType ?? null,
    commercialStatus: commercialStatus(raw.situacao) ?? parent?.commercialStatus ?? null,
    productionType: productionType(raw.tipoProducao) ?? parent?.productionType ?? null,
    expirationDate: dateOrNull(raw.dataValidade) ?? parent?.expirationDate ?? null,
    freeShipping: booleanOrNull(raw.freteGratis) ?? parent?.freeShipping ?? null,
    volumes: integer(raw.volumes) ?? parent?.volumes ?? null,
    itemsPerBox: positiveOrNull(raw.itensPorCaixa) ?? parent?.itemsPerBox ?? null,
    origin: firstText(raw.origem, tax.origem, parent?.origin),
    storeLinks: parent?.storeLinks ?? [],
    storeLinksComplete: parent?.storeLinksComplete ?? false,
    isVariation: variation
  };
}

function normalizePage(payload: BlingCatalogResponse, httpStatus = 200) {
  const rows = list(payload.data);
  const products: NormalizedBlingProduct[] = [];
  let invalidRows = 0;

  for (const row of rows) {
    const product = normalizeOne(row);
    if (!product) {
      invalidRows += 1;
      continue;
    }
    products.push(product);
    for (const variationValue of list(record(row).variacoes)) {
      const variation = normalizeOne(variationValue, product);
      if (variation) products.push(variation);
      else invalidRows += 1;
    }
  }

  const total = extractReportedTotal(payload);
  return {
    products,
    sourceRowCount: rows.length,
    invalidRows,
    totalReported: total.reportedTotal,
    totalSource: total.totalSource,
    totalInvalid: total.totalInvalid,
    httpStatus
  };
}

export function normalizeBlingCatalogPage(payload: unknown) {
  return normalizePage(record(payload) as BlingCatalogResponse);
}

function preferDetailValue<T>(detail: T | null, summary: T | null) {
  return detail ?? summary;
}

function mergeBlingProductDetail(
  summary: NormalizedBlingProduct,
  detail: NormalizedBlingProduct
): NormalizedBlingProduct {
  return {
    ...summary,
    name: detail.name,
    sku: preferDetailValue(detail.sku, summary.sku),
    gtin: preferDetailValue(detail.gtin, summary.gtin),
    packagingGtin: preferDetailValue(detail.packagingGtin, summary.packagingGtin),
    description: preferDetailValue(detail.description, summary.description),
    shortDescription: preferDetailValue(detail.shortDescription, summary.shortDescription),
    price: preferDetailValue(detail.price, summary.price),
    costPrice: preferDetailValue(detail.costPrice, summary.costPrice),
    stock: preferDetailValue(detail.stock, summary.stock),
    unit: preferDetailValue(detail.unit, summary.unit),
    imageUrl: preferDetailValue(detail.imageUrl, summary.imageUrl),
    images: detail.images.length ? detail.images : summary.images,
    brand: preferDetailValue(detail.brand, summary.brand),
    category: preferDetailValue(detail.category, summary.category),
    categoryId: preferDetailValue(detail.categoryId, summary.categoryId),
    ncm: preferDetailValue(detail.ncm, summary.ncm),
    weight: preferDetailValue(detail.weight, summary.weight),
    grossWeight: preferDetailValue(detail.grossWeight, summary.grossWeight),
    height: preferDetailValue(detail.height, summary.height),
    width: preferDetailValue(detail.width, summary.width),
    depth: preferDetailValue(detail.depth, summary.depth),
    dimensionUnit: preferDetailValue(detail.dimensionUnit, summary.dimensionUnit),
    condition: preferDetailValue(detail.condition, summary.condition),
    status: detail.status === "UNKNOWN" ? summary.status : detail.status,
    format: preferDetailValue(detail.format, summary.format),
    productType: preferDetailValue(detail.productType, summary.productType),
    commercialStatus: preferDetailValue(detail.commercialStatus, summary.commercialStatus),
    productionType: preferDetailValue(detail.productionType, summary.productionType),
    expirationDate: preferDetailValue(detail.expirationDate, summary.expirationDate),
    freeShipping: preferDetailValue(detail.freeShipping, summary.freeShipping),
    volumes: preferDetailValue(detail.volumes, summary.volumes),
    itemsPerBox: preferDetailValue(detail.itemsPerBox, summary.itemsPerBox),
    origin: preferDetailValue(detail.origin, summary.origin),
    storeLinks: detail.storeLinksComplete ? detail.storeLinks : summary.storeLinks,
    storeLinksComplete: detail.storeLinksComplete || summary.storeLinksComplete,
    parentExternalProductId: summary.parentExternalProductId,
    isVariation: summary.isVariation
  };
}

export async function hydrateNewBlingProductFromDetail(
  input: {
    organizationId: string;
    connectionId: string;
    product: NormalizedBlingProduct;
  },
  fetchDetail: (request: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  }) => Promise<unknown> = async (request) =>
    blingApiClient.request<unknown>({
      organizationId: request.organizationId,
      connectionId: request.connectionId,
      method: "GET",
      path: `/produtos/${encodeURIComponent(request.externalProductId)}`
    })
) {
  const payload = await fetchDetail({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    externalProductId: input.product.externalProductId
  });
  const detail = normalizeOne(record(payload).data ?? payload);
  if (!detail || detail.externalProductId !== input.product.externalProductId) {
    throw new Error("O detalhe retornado pelo Bling nao corresponde ao produto solicitado.");
  }
  return mergeBlingProductDetail(input.product, detail);
}

function publicHttpsUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeProviderEvidence(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
}

function explicitMarketplaceProvider(input: {
  externalListingId: string | null;
  channel: unknown;
}): NormalizedBlingStoreLink["provider"] {
  if (/^MLB-?\d+$/i.test(input.externalListingId ?? "")) return "MERCADO_LIVRE";
  const channel = record(input.channel);
  const integration = record(channel.integracao);
  const evidence = [
    channel.tipo,
    channel.nome,
    channel.descricao,
    channel.plataforma,
    channel.canal,
    integration.nome,
    integration.tipo,
    integration.plataforma
  ].map(normalizeProviderEvidence);
  return evidence.some((value) => value.includes("MERCADOLIVRE"))
    ? "MERCADO_LIVRE"
    : null;
}

export function normalizeBlingProductStoreLink(input: {
  row: unknown;
  channel?: unknown;
  externalProductId: string;
}): NormalizedBlingStoreLink | null {
  const row = record(input.row);
  const product = record(row.produto);
  const store = record(row.loja);
  const linkedProductId = firstText(product.id, row.idProduto);
  const linkId = firstText(row.id, row.idProdutoLoja);
  const storeId = firstText(store.id, row.idLoja);
  if (
    !linkId
    || !storeId
    || linkedProductId !== input.externalProductId
  ) {
    return null;
  }
  const channel = record(record(input.channel).data ?? input.channel);
  const externalListingId = firstText(row.codigo, row.externalListingId, row.idNaLoja);
  return {
    linkId,
    storeId,
    storeName: firstText(
      store.nome,
      store.descricao,
      channel.nome,
      channel.descricao
    ),
    provider: explicitMarketplaceProvider({ externalListingId, channel }),
    externalListingId,
    status: firstText(row.situacao, row.status),
    url: publicHttpsUrl(
      firstText(row.url, row.link, row.permalink, row.urlProduto)
    )
  };
}

const blingChannelCache = new Map<string, Promise<unknown>>();
const blingCategoryCache = new Map<string, Promise<string | null>>();

async function fetchBlingChannel(input: {
  organizationId: string;
  connectionId: string;
  storeId: string;
}) {
  const key = `${input.organizationId}:${input.connectionId}:${input.storeId}`;
  const cached = blingChannelCache.get(key);
  if (cached) return cached;
  const request = blingApiClient.request<unknown>({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    method: "GET",
    path: `/canais-venda/${encodeURIComponent(input.storeId)}`
  });
  blingChannelCache.set(key, request);
  try {
    return await request;
  } catch (error) {
    blingChannelCache.delete(key);
    throw error;
  }
}

export async function fetchBlingProductStoreLinks(
  input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  },
  dependencies: {
    fetchPage?: (request: {
      organizationId: string;
      connectionId: string;
      externalProductId: string;
      page: number;
      limit: number;
    }) => Promise<unknown>;
    fetchChannel?: (request: {
      organizationId: string;
      connectionId: string;
      storeId: string;
    }) => Promise<unknown>;
  } = {}
) {
  const limit = 100;
  const links = new Map<string, NormalizedBlingStoreLink>();
  const fetchPage = dependencies.fetchPage ?? (async (request) =>
    blingApiClient.request<unknown>({
      organizationId: request.organizationId,
      connectionId: request.connectionId,
      method: "GET",
      path: "/produtos/lojas",
      query: {
        pagina: request.page,
        limite: request.limit,
        idProduto: request.externalProductId
      }
    }));
  const fetchChannel = dependencies.fetchChannel ?? fetchBlingChannel;

  for (let page = 1; page <= maxSafetyPages; page += 1) {
    const payload = await fetchPage({ ...input, page, limit });
    const rows = list(record(payload).data);
    for (const row of rows) {
      const raw = record(row);
      const linkedProductId = firstText(record(raw.produto).id, raw.idProduto);
      if (linkedProductId !== input.externalProductId) {
        throw new Error("O Bling retornou um vinculo de loja pertencente a outro produto.");
      }
      const storeId = firstText(record(raw.loja).id, raw.idLoja);
      if (!storeId) {
        throw new Error("O vinculo produto-loja retornado pelo Bling nao possui loja.");
      }
      const channel = await fetchChannel({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        storeId
      });
      const normalized = normalizeBlingProductStoreLink({
        row,
        channel,
        externalProductId: input.externalProductId
      });
      if (!normalized) {
        throw new Error("O vinculo produto-loja retornado pelo Bling e invalido.");
      }
      const identity = `${normalized.linkId}:${normalized.storeId}`;
      links.set(identity, normalized);
    }
    if (rows.length < limit) return [...links.values()];
  }
  throw new Error("A consulta de lojas do produto excedeu o limite seguro de paginas.");
}

export async function fetchBlingProductStock(
  input: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  },
  fetchStock: (request: {
    organizationId: string;
    connectionId: string;
    externalProductId: string;
  }) => Promise<unknown> = async (request) =>
    blingApiClient.request<unknown>({
      organizationId: request.organizationId,
      connectionId: request.connectionId,
      method: "GET",
      path: "/estoques/saldos",
      query: { "idsProdutos[]": request.externalProductId }
    })
) {
  const payload = await fetchStock(input);
  const row = list(record(payload).data).find((candidate) =>
    firstText(record(record(candidate).produto).id, record(candidate).idProduto)
      === input.externalProductId
  );
  if (!row) {
    throw new Error("O Bling nao retornou o saldo do produto solicitado.");
  }
  const stock = firstNumber(
    record(row).saldoVirtualTotal,
    record(row).saldoFisicoTotal
  );
  if (stock === null) {
    throw new Error("O saldo retornado pelo Bling e invalido.");
  }
  return Math.trunc(stock);
}

export async function fetchBlingProductCategory(
  input: {
    organizationId: string;
    connectionId: string;
    categoryId: string;
  },
  fetchCategory?: (request: {
    organizationId: string;
    connectionId: string;
    categoryId: string;
  }) => Promise<unknown>
) {
  if (fetchCategory) {
    const payload = await fetchCategory(input);
    const category = record(record(payload).data ?? payload);
    if (firstText(category.id) !== input.categoryId) {
      throw new Error("O Bling retornou uma categoria diferente da solicitada.");
    }
    return firstText(category.descricao, category.nome);
  }

  const key = `${input.organizationId}:${input.connectionId}:${input.categoryId}`;
  const cached = blingCategoryCache.get(key);
  if (cached) return cached;
  const request = blingApiClient.request<unknown>({
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    method: "GET",
    path: `/categorias/produtos/${encodeURIComponent(input.categoryId)}`
  }).then((payload) => {
    const category = record(record(payload).data ?? payload);
    if (firstText(category.id) !== input.categoryId) {
      throw new Error("O Bling retornou uma categoria diferente da solicitada.");
    }
    return firstText(category.descricao, category.nome);
  });
  blingCategoryCache.set(key, request);
  try {
    return await request;
  } catch (error) {
    blingCategoryCache.delete(key);
    throw error;
  }
}

export async function hydrateBlingProductForPersistence(
  input: {
    organizationId: string;
    connectionId: string;
    product: NormalizedBlingProduct;
  },
  dependencies: {
    fetchDetail?: Parameters<typeof hydrateNewBlingProductFromDetail>[1];
    fetchStock?: Parameters<typeof fetchBlingProductStock>[1];
    fetchCategory?: Parameters<typeof fetchBlingProductCategory>[1];
    fetchStoreLinks?: typeof fetchBlingProductStoreLinks;
  } = {}
) {
  const detailed = await hydrateNewBlingProductFromDetail(
    input,
    dependencies.fetchDetail
  );
  const relatedInput = {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    externalProductId: input.product.externalProductId
  };
  const [stock, category, storeLinks] = await Promise.all([
    fetchBlingProductStock(relatedInput, dependencies.fetchStock),
    detailed.categoryId && !detailed.category
      ? fetchBlingProductCategory(
          { ...input, categoryId: detailed.categoryId },
          dependencies.fetchCategory
        )
      : Promise.resolve(detailed.category),
    (dependencies.fetchStoreLinks ?? fetchBlingProductStoreLinks)(relatedInput)
  ]);
  return {
    ...detailed,
    stock,
    category: category ?? detailed.category,
    storeLinks,
    storeLinksComplete: true
  };
}

export function resolveImportedGtin(remoteValue: string | null, currentValue: string | null = null) {
  const normalized = normalizeGtin(remoteValue);
  return normalized && isValidGtin(normalized) ? normalized : currentValue;
}

function isTemporary(error: unknown) {
  return error instanceof BlingApiError && (error.code === "RATE_LIMITED" || error.code === "TEMPORARY_FAILURE");
}

function classifyPreviewFailure(error: unknown) {
  if (error instanceof BlingApiError) {
    return {
      httpStatus: error.status,
      errorCode: error.code,
      requestIdMasked: error.details?.requestIdMasked
    };
  }
  return { errorCode: "UNEXPECTED_ERROR" };
}

function previewFailureDiagnostic(input: {
  correlationId: string;
  stage: BlingImportPreviewFailureDiagnostic["stage"];
  startedAt: number;
  error?: unknown;
  errorCode?: string;
  page?: number | null;
  expectedPages?: number | null;
  pageCounts?: number[];
  pageStatuses?: number[];
  pagesCompleted?: number;
  lastDataPage?: number;
  sentinelPage?: number | null;
  reportedTotal?: number | null;
  derivedTotal?: number | null;
  totalSource?: BlingImportTotalSource;
  uniqueProductsLoaded?: number;
  duplicateCount?: number;
  invalidCount?: number;
  paginationComplete?: boolean;
  previewComplete?: boolean;
  jobCreated?: boolean;
}): BlingImportPreviewFailureDiagnostic {
  const failure = classifyPreviewFailure(input.error);
  return {
    correlationId: input.correlationId,
    stage: input.stage,
    page: input.page ?? null,
    expectedPages: input.expectedPages ?? null,
    httpStatus: failure.httpStatus ?? null,
    errorCode: input.errorCode ?? failure.errorCode ?? "UNEXPECTED_ERROR",
    requestIdMasked: failure.requestIdMasked ?? null,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    pageSize,
    pageCounts: input.pageCounts ?? [],
    pageStatuses: input.pageStatuses ?? [],
    pagesCompleted: input.pagesCompleted ?? 0,
    lastDataPage: input.lastDataPage ?? 0,
    sentinelPage: input.sentinelPage ?? null,
    reportedTotal: input.reportedTotal ?? null,
    derivedTotal: input.derivedTotal ?? null,
    totalSource: input.totalSource ?? "NONE",
    uniqueProductsLoaded: input.uniqueProductsLoaded ?? 0,
    duplicateCount: input.duplicateCount ?? 0,
    invalidCount: input.invalidCount ?? 0,
    paginationComplete: input.paginationComplete ?? false,
    previewComplete: input.previewComplete ?? false,
    jobCreated: input.jobCreated ?? false
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCatalogPage(input: {
  organizationId: string;
  connectionId: string;
  page: number;
  readOnly: boolean;
  criterion?: 1 | 5;
  allowRetry?: boolean;
  onResponseMeta?: (metadata: { status: number; requestIdMasked?: string }) => void;
}) {
  const attempts = input.allowRetry === false ? 1 : maxRetryAttempts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const request = {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        path: "/produtos",
        query: { pagina: input.page, limite: pageSize, criterio: input.criterion ?? 1 },
        timeoutMs: input.readOnly ? previewPageTimeoutMs : undefined,
        onResponseMeta: input.onResponseMeta
      };
      return input.readOnly
        ? await blingApiClient.requestReadOnly<BlingCatalogResponse>(request)
        : await blingApiClient.request<BlingCatalogResponse>({ ...request, method: "GET" });
    } catch (error) {
      if (!isTemporary(error) || attempt === attempts) throw error;
      const retryAfter = error instanceof BlingApiError ? error.retryAfter : undefined;
      await wait(Math.min(30_000, Math.max(1_000, (retryAfter ?? attempt) * 1_000)));
    }
  }
  throw new Error("Nao foi possivel consultar o catalogo Bling.");
}

async function loadMappings(organizationId: string, connectionId: string, externalProductIds: string[]) {
  const mappings = new Map<string, string>();
  for (let start = 0; start < externalProductIds.length; start += 1_000) {
    const rows = await prisma.productExternalMapping.findMany({
      where: {
        organizationId,
        connectionId,
        externalProductId: { in: externalProductIds.slice(start, start + 1_000) }
      },
      select: { externalProductId: true, productId: true }
    });
    for (const row of rows) mappings.set(row.externalProductId, row.productId);
  }
  return mappings;
}

async function loadIdentityCandidates(
  organizationId: string,
  field: "sku" | "ean",
  values: string[]
) {
  const candidates = new Map<string, ProductIdentityCandidate[]>();
  const uniqueValues = [...new Set(values.filter(Boolean))];
  for (let start = 0; start < uniqueValues.length; start += 1_000) {
    const chunk = uniqueValues.slice(start, start + 1_000);
    const rows = await prisma.product.findMany({
      where: {
        organizationId,
        [field]: { in: chunk }
      },
      select: { id: true, sku: true, ean: true }
    });
    for (const row of rows) {
      const rawIdentity = field === "sku" ? row.sku?.trim() : normalizeGtin(row.ean);
      if (!rawIdentity) continue;
      const current = candidates.get(rawIdentity) ?? [];
      current.push({ id: row.id });
      candidates.set(rawIdentity, current);
    }
  }
  return candidates;
}

async function classifyBlingProductsForConnection(input: {
  organizationId: string;
  connectionId: string;
  products: NormalizedBlingProduct[];
}) {
  const mappings = await loadMappings(
    input.organizationId,
    input.connectionId,
    input.products.map((product) => product.externalProductId)
  );
  const unmatched = input.products.filter((product) => !mappings.has(product.externalProductId));
  const skuCandidates = await loadIdentityCandidates(
    input.organizationId,
    "sku",
    unmatched.map((product) => product.sku?.trim() ?? "").filter(Boolean)
  );
  const productsWithoutSkuMatch = unmatched.filter((product) => {
    const sku = product.sku?.trim();
    return !sku || (skuCandidates.get(sku)?.length ?? 0) === 0;
  });
  const gtinCandidates = await loadIdentityCandidates(
    input.organizationId,
    "ean",
    productsWithoutSkuMatch
      .map((product) => normalizeGtin(product.gtin))
      .filter((gtin): gtin is string => Boolean(gtin && isValidGtin(gtin)))
  );

  const matches = new Map<string, BlingProductImportMatch>();
  const summary: BlingProductImportMatchSummary = {
    updatedByMapping: 0,
    linkedBySku: 0,
    linkedByGtin: 0,
    created: 0,
    needsReview: 0,
    skuConflicts: 0,
    gtinConflicts: 0
  };

  for (const product of input.products) {
    const sku = product.sku?.trim() ?? null;
    const gtin = normalizeGtin(product.gtin);
    const match = resolveBlingProductImportMatch({
      mappedProductId: mappings.get(product.externalProductId),
      sku,
      gtin,
      skuCandidates: sku ? skuCandidates.get(sku) : undefined,
      gtinCandidates: gtin && isValidGtin(gtin) ? gtinCandidates.get(gtin) : undefined
    });
    matches.set(product.externalProductId, match);
    if (match.kind === "MAPPING") summary.updatedByMapping += 1;
    else if (match.kind === "SKU") summary.linkedBySku += 1;
    else if (match.kind === "GTIN") summary.linkedByGtin += 1;
    else if (match.kind === "CREATE") summary.created += 1;
    else {
      summary.needsReview += 1;
      if (match.conflictField === "SKU") summary.skuConflicts += 1;
      if (match.conflictField === "GTIN") summary.gtinConflicts += 1;
    }
  }

  return { mappings, matches, summary };
}

export async function validateBlingProductImportConnection(
  organizationId: string,
  connectionId: string,
  options: { allowOfficialRefresh?: boolean } = {}
) {
  const connection = await prisma.blingConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      status: true,
      tokens: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, expiresAt: true }
      }
    }
  });
  if (!connection) {
    throw new BlingApiError("Conta Bling nao encontrada.", 404, "CONNECTION_NOT_FOUND");
  }
  if (
    connection.status !== "ACTIVE"
    || !connection.tokens.length
    || (
      !options.allowOfficialRefresh
      && connection.tokens[0].expiresAt.getTime() <= Date.now()
    )
  ) {
    throw new BlingApiError("Reconecte a conta Bling antes de continuar.", 401, "TOKEN_MISSING");
  }
  return connection;
}

async function fetchAllProducts(input: {
  organizationId: string;
  connectionId: string;
  readOnly: boolean;
  criterion?: 1 | 5;
  correlationId?: string;
  onProgress?: (progress: BlingPreviewJobProgress) => Promise<void> | void;
}) {
  const collected = await collectBlingPreviewPages<NormalizedBlingProduct>({
    correlationId: input.correlationId ?? "background-catalog-read",
    pageSize,
    maxPages: maxSafetyPages,
    fetchPage: async (page) => {
      let responseStatus = 0;
      const payload = await fetchCatalogPage({
        ...input,
        page,
        allowRetry: !input.correlationId,
        onResponseMeta: (metadata) => {
          responseStatus = metadata.status;
        }
      });
      try {
        return normalizePage(payload, responseStatus);
      } catch (error) {
        throw new BlingImportPreviewError(
          "A pagina retornada pelo Bling nao pode ser normalizada.",
          previewFailureDiagnostic({
            correlationId: input.correlationId ?? "background-catalog-read",
            stage: "NORMALIZATION",
            startedAt: Date.now(),
            error,
            page
          })
        );
      }
    },
    productKey: (product) => product.externalProductId,
    classifyFailure: classifyPreviewFailure,
    onPageCompleted: async (progress) => input.onProgress?.({
      stage: "CATALOG_PAGE",
      currentPage: progress.page,
      pagesCompleted: progress.pagesCompleted,
      itemsProcessed: progress.sourceRowsFetched,
      totalItems: null,
      uniqueProducts: progress.uniqueProductsLoaded,
      duplicateCount: 0,
      invalidCount: progress.invalidRows,
      withChanges: 0,
      withoutChanges: 0,
      failures: 0,
      heartbeatAt: new Date().toISOString(),
      processedExternalIds: progress.processedExternalIds
    })
  });

  return {
    ...collected,
    errors: collected.invalidRows,
    completed: collected.terminated
  };
}

function setKnownAttribute(
  target: Record<string, unknown>,
  key: string,
  value: unknown
) {
  if (value === null || value === undefined) return;
  if (typeof value === "string" && !value.trim()) return;
  target[key] = value;
}

export function mergeBlingProductAttributes(
  current: Prisma.JsonValue | Prisma.InputJsonValue | null,
  product: NormalizedBlingProduct,
  connectionId: string,
  statusCheckedAt = new Date().toISOString()
) {
  const existing = record(current);
  const existingBling = record(existing.bling);
  const existingConnections = record(existingBling.connections);
  const legacyValues = { ...existingBling };
  delete legacyValues.connections;
  const legacyForConnection =
    text(existingBling.connectionId) === connectionId ? legacyValues : {};
  const scoped = {
    ...legacyForConnection,
    ...record(existingConnections[connectionId])
  };
  const normalizedStatus = normalizeBlingProductStatus(product.status);
  const nextScoped: Record<string, unknown> = {
    ...scoped,
    externalProductId: product.externalProductId,
    connectionId,
    source: "CATALOG_READ"
  };
  setKnownAttribute(nextScoped, "parentExternalProductId", product.parentExternalProductId);
  setKnownAttribute(nextScoped, "sku", product.sku);
  setKnownAttribute(nextScoped, "format", product.format);
  setKnownAttribute(nextScoped, "productType", product.productType);
  setKnownAttribute(nextScoped, "commercialStatus", product.commercialStatus);
  setKnownAttribute(nextScoped, "productionType", product.productionType);
  setKnownAttribute(nextScoped, "shortDescription", product.shortDescription);
  setKnownAttribute(nextScoped, "unit", product.unit);
  setKnownAttribute(nextScoped, "origin", product.origin);
  setKnownAttribute(nextScoped, "categoryId", product.categoryId);
  if (normalizedStatus.status !== "UNKNOWN") {
    nextScoped.status = normalizedStatus.status;
    nextScoped.externalStatus = normalizedStatus.externalStatus;
    nextScoped.statusCheckedAt = statusCheckedAt;
  }
  if (product.storeLinksComplete) {
    nextScoped.storeLinks = product.storeLinks;
    nextScoped.storeLinksComplete = true;
  }

  return {
    ...existing,
    bling: {
      ...existingBling,
      ...nextScoped,
      connections: {
        ...existingConnections,
        [connectionId]: nextScoped
      }
    }
  } as Prisma.InputJsonValue;
}

export function mergeBlingProductStatusAttributes(
  current: Prisma.JsonValue | Prisma.InputJsonValue | null,
  status: CanonicalBlingProductStatus,
  externalStatus: "A" | "I" | "E" | null,
  statusCheckedAt: string,
  connectionId?: string
) {
  const existing = record(current);
  const existingBling = record(existing.bling);
  if (!connectionId) {
    return {
      ...existing,
      bling: {
        ...existingBling,
        status,
        externalStatus,
        statusCheckedAt
      }
    } as Prisma.InputJsonValue;
  }
  const existingConnections = record(existingBling.connections);
  const nextScoped = {
    ...readBlingProductConnectionAttributes(current, connectionId),
    connectionId,
    status,
    externalStatus,
    statusCheckedAt
  };
  return {
    ...existing,
    bling: {
      ...existingBling,
      ...nextScoped,
      connections: {
        ...existingConnections,
        [connectionId]: nextScoped
      }
    }
  } as Prisma.InputJsonValue;
}

export function readBlingProductMarketplaceStores(
  attributes: unknown,
  connectionId?: string | null
) {
  const bling = readBlingProductConnectionAttributes(attributes, connectionId);
  return {
    mercadoLivre: list(bling.storeLinks).some((value) => {
      const link = record(value);
      const provider = text(link.provider).toUpperCase();
      const externalListingId = text(link.externalListingId);
      const status = text(link.status).toLowerCase();
      return (
        provider === "MERCADO_LIVRE"
        && /^MLB-?\d+$/i.test(externalListingId)
        && !["closed", "deleted", "inactive", "inativo", "excluido"].includes(status)
      );
    })
  };
}

export function buildBlingProductStatusConditionalUpdate(
  input: BlingProductStatusConditionalUpdateInput
) {
  return {
    where: {
      id: input.productId,
      organizationId: input.organizationId,
      updatedAt: input.updatedAt,
      mappings: {
        some: {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          externalProductId: input.externalProductId
        }
      }
    },
    data: {
      attributes: mergeBlingProductStatusAttributes(
        input.attributes,
        input.status,
        input.externalStatus,
        input.statusCheckedAt,
        input.connectionId
      ),
      updatedAt: input.updatedAt
    }
  } satisfies Prisma.ProductUpdateManyArgs;
}

export function classifyBlingProductStatusConditionalUpdate(input: {
  count: number;
  originalUpdatedAt: Date;
  currentUpdatedAt: Date | null;
  identityMatches: boolean;
}) {
  if (input.count === 1) return "UPDATED" as const;
  if (input.count === 0) {
    if (!input.identityMatches || !input.currentUpdatedAt) return "IDENTITY_MISMATCH" as const;
    if (input.currentUpdatedAt.getTime() !== input.originalUpdatedAt.getTime()) {
      return "CONCURRENT_UPDATE" as const;
    }
    return "IDENTITY_MISMATCH" as const;
  }
  throw new Error("A atualizacao condicional de status afetou mais de um produto.");
}

function productStatusMetadataMatches(
  attributes: Prisma.JsonValue | null,
  expected: NormalizedBlingProductStatus,
  connectionId: string
) {
  const bling = readBlingProductConnectionAttributes(attributes, connectionId);
  return (
    readCanonicalBlingStatusFromAttributes(attributes, connectionId) === expected.status &&
    text(bling.externalStatus).toUpperCase() === expected.externalStatus
  );
}

async function reconcileLinkedStatusSnapshot(input: {
  organizationId: string;
  connectionId: string;
  products: NormalizedBlingProduct[];
  confirm: boolean;
  fetched: { pagesFound: number; errors: number; completed: boolean };
}) {
  const statusByExternalId = new Map<string, NormalizedBlingProductStatus>();
  const conflictingExternalIds = new Set<string>();
  for (const product of input.products) {
    const nextStatus = normalizeBlingProductStatus(product.status);
    const currentStatus = statusByExternalId.get(product.externalProductId);
    if (!currentStatus) {
      statusByExternalId.set(product.externalProductId, nextStatus);
    } else if (
      currentStatus.status !== nextStatus.status ||
      currentStatus.externalStatus !== nextStatus.externalStatus
    ) {
      conflictingExternalIds.add(product.externalProductId);
    }
  }

  const mappings = await prisma.productExternalMapping.findMany({
    where: { organizationId: input.organizationId, connectionId: input.connectionId },
    select: {
      externalProductId: true,
      product: { select: { id: true, attributes: true, updatedAt: true } }
    }
  });
  const mappedExternalIds = new Set(mappings.map((mapping) => mapping.externalProductId));
  const changes = mappings.flatMap((mapping) => {
    const status = statusByExternalId.get(mapping.externalProductId);
    if (!status || conflictingExternalIds.has(mapping.externalProductId)) return [];
    if (productStatusMetadataMatches(mapping.product.attributes, status, input.connectionId)) return [];
    return [{ externalProductId: mapping.externalProductId, product: mapping.product, status }];
  });
  const linkedStatuses = mappings.map((mapping) => statusByExternalId.get(mapping.externalProductId));
  const linkedRecordsWithoutCatalogStatus = linkedStatuses.filter((status) => !status).length;
  const linkedConflicts = mappings.filter((mapping) => conflictingExternalIds.has(mapping.externalProductId)).length;
  const linkedUnknownStatuses = linkedStatuses.filter((status) => status?.status === "UNKNOWN").length;

  let writesPerformed = 0;
  let concurrentUpdates = 0;
  let identityMismatches = 0;
  if (input.confirm) {
    if (!input.fetched.completed || input.fetched.errors || linkedConflicts || linkedUnknownStatuses) {
      throw new Error("O catalogo Bling apresentou divergencias; nenhuma atualizacao de status foi executada.");
    }
    if (linkedRecordsWithoutCatalogStatus > 0) {
      throw new Error("Nem todos os produtos vinculados possuem status confirmado; nenhuma atualizacao foi executada.");
    }

    const statusCheckedAt = new Date().toISOString();
    for (let start = 0; start < changes.length; start += 100) {
      const batch = changes.slice(start, start + 100);
      const results = await prisma.$transaction(
        batch.map((change) =>
          prisma.product.updateMany(
            buildBlingProductStatusConditionalUpdate({
              productId: change.product.id,
              organizationId: input.organizationId,
              connectionId: input.connectionId,
              externalProductId: change.externalProductId,
              attributes: change.product.attributes,
              updatedAt: change.product.updatedAt,
              status: change.status.status,
              externalStatus: change.status.externalStatus,
              statusCheckedAt
            })
          )
        )
      );
      for (const [index, result] of results.entries()) {
        const change = batch[index];
        let currentIdentity: { updatedAt: Date } | null = null;
        if (result.count === 0) {
          currentIdentity = await prisma.product.findFirst({
            where: {
              id: change.product.id,
              organizationId: input.organizationId,
              mappings: {
                some: {
                  organizationId: input.organizationId,
                  connectionId: input.connectionId,
                  externalProductId: change.externalProductId
                }
              }
            },
            select: { updatedAt: true }
          });
        }
        const outcome = classifyBlingProductStatusConditionalUpdate({
          count: result.count,
          originalUpdatedAt: change.product.updatedAt,
          currentUpdatedAt: currentIdentity?.updatedAt ?? null,
          identityMatches: Boolean(currentIdentity)
        });
        if (outcome === "UPDATED") writesPerformed += 1;
        else if (outcome === "CONCURRENT_UPDATE") concurrentUpdates += 1;
        else identityMismatches += 1;
      }
    }
  }

  const countStatus = (status: CanonicalBlingProductStatus) =>
    linkedStatuses.filter((candidate) => candidate?.status === status).length;

  return {
    mode: input.confirm ? "CONFIRMED" : "DRY_RUN",
    catalogProductsFound: statusByExternalId.size,
    catalogPagesFound: input.fetched.pagesFound,
    linkedProducts: mappings.length,
    externalIdsLocated: mappings.length - linkedRecordsWithoutCatalogStatus,
    active: countStatus("ACTIVE"),
    inactive: countStatus("INACTIVE"),
    deleted: countStatus("DELETED"),
    unknown: linkedUnknownStatuses + linkedRecordsWithoutCatalogStatus + linkedConflicts,
    divergences: changes.length + linkedRecordsWithoutCatalogStatus + linkedConflicts,
    recordsWouldChange: changes.length,
    recordsAlreadyCorrect: mappings.length - changes.length - linkedRecordsWithoutCatalogStatus - linkedConflicts,
    linkedRecordsWithoutCatalogStatus,
    catalogRecordsWithoutLink: [...statusByExternalId.keys()].filter((externalId) => !mappedExternalIds.has(externalId)).length,
    conflictingExternalIds: conflictingExternalIds.size,
    errors: input.fetched.errors,
    completed: input.fetched.completed,
    writesPerformed,
    concurrentUpdates,
    identityMismatches
  } satisfies BlingProductStatusBackfillReport;
}

function draftData(product: NormalizedBlingProduct, organizationId: string, erpConnectionId: string, connectionId: string) {
  return {
    organizationId,
    erpConnectionId,
    blingConnectionId: connectionId,
    externalId: product.externalProductId,
    sku: product.sku,
    gtin: product.gtin,
    name: product.name,
    description: product.description,
    price: product.price,
    costPrice: product.costPrice,
    stock: product.stock,
    unit: product.unit,
    imageUrl: product.imageUrl,
    brand: normalizeProductBrand(product.brand),
    category: product.category,
    ncm: product.ncm,
    weight: product.weight,
    height: product.height,
    width: product.width,
    depth: product.depth,
    status: product.status,
    rawData: {
      externalProductId: product.externalProductId,
      parentExternalProductId: product.parentExternalProductId,
      format: product.format,
      isVariation: product.isVariation,
      packagingGtin: product.packagingGtin,
      categoryId: product.categoryId,
      shortDescription: product.shortDescription,
      productType: product.productType,
      commercialStatus: product.commercialStatus,
      productionType: product.productionType,
      expirationDate: product.expirationDate?.toISOString().slice(0, 10) ?? null,
      freeShipping: product.freeShipping,
      volumes: product.volumes,
      itemsPerBox: product.itemsPerBox,
      origin: product.origin,
      images: product.images,
      storeLinks: product.storeLinks,
      storeLinksComplete: product.storeLinksComplete
    } satisfies Prisma.InputJsonObject,
    lastFetchedAt: new Date()
  };
}

async function updateLocalPrice(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  product: NormalizedBlingProduct
) {
  if (product.price === null && product.costPrice === null) return false;
  const latest = await transaction.productPrice.findFirst({
    where: { organizationId, productId },
    orderBy: { createdAt: "desc" },
    select: { id: true, salePrice: true, costPrice: true }
  });
  const salePrice = product.price ?? Number(latest?.salePrice ?? 0);
  const costPrice = product.costPrice ?? Number(latest?.costPrice ?? 0);
  if (latest) {
    if (
      Number(latest.salePrice) === salePrice
      && Number(latest.costPrice) === costPrice
    ) {
      return false;
    }
    await transaction.productPrice.update({ where: { id: latest.id }, data: { salePrice, costPrice } });
  } else {
    await transaction.productPrice.create({ data: { organizationId, productId, salePrice, costPrice } });
  }
  return true;
}

async function updateLocalInventory(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  connectionId: string,
  productId: string,
  stock: number | null
) {
  if (stock === null) return false;
  const current = await transaction.inventoryBalance.findUnique({
    where: { productId_connectionId_warehouse: { productId, connectionId, warehouse: "Bling" } },
    select: { id: true, physicalQuantity: true }
  });
  if (current?.physicalQuantity === stock) return false;
  if (current) {
    await transaction.inventoryBalance.update({
      where: { id: current.id },
      data: { physicalQuantity: stock }
    });
  } else {
    await transaction.inventoryBalance.create({
      data: { organizationId, productId, connectionId, warehouse: "Bling", physicalQuantity: stock }
    });
  }
  return true;
}

export async function appendMissingBlingProductImages(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  images: readonly string[]
) {
  const normalized = normalizeBlingProductImages(images);
  if (!normalized.length) return false;
  const current = await transaction.productImage.findMany({
    where: { organizationId, productId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { url: true, position: true }
  });
  const existing = new Set(
    normalizeBlingProductImages(current.map((image) => image.url))
  );
  const missing = normalized.filter((url) => !existing.has(url));
  if (!missing.length) return false;
  const firstPosition = current.reduce(
    (highest, image) => Math.max(highest, image.position),
    -1
  ) + 1;
  await transaction.productImage.createMany({
    data: missing.map((url, index) => ({
      organizationId,
      productId,
      url,
      position: firstPosition + index
    }))
  });
  return true;
}

function sameNullableNumber(left: Prisma.Decimal | number | null, right: number | null) {
  if (left === null || right === null) return left === null && right === null;
  return Number(left) === right;
}

function syncReportValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 180);
  return JSON.stringify(value).slice(0, 180);
}

function addSyncChange(
  changes: BlingProductSyncChange[],
  category: BlingProductSyncChange["category"],
  field: string,
  previousValue: unknown,
  newValue: unknown,
  delta?: number,
  comparison?: { previousValue: unknown; newValue: unknown }
) {
  if (!hasMeaningfulSyncChange(
    comparison?.previousValue ?? previousValue,
    comparison?.newValue ?? newValue,
    field,
    category
  )) return;
  changes.push({
    category,
    field,
    previousValue: syncReportValue(previousValue),
    newValue: syncReportValue(newValue),
    ...(delta === undefined ? {} : { delta })
  });
}

function storeLinksReportValue(value: readonly NormalizedBlingStoreLink[]) {
  return [...new Set(value.map((item) =>
    item.storeName || item.storeId || item.linkId
  ).filter(Boolean))].sort().join(", ");
}

function normalizedStoreLinks(value: unknown) {
  const unique = new Map<string, NormalizedBlingStoreLink>();
  for (const candidate of list(value)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as unknown as NormalizedBlingStoreLink;
    const key = [
      item.storeId,
      item.linkId,
      item.provider,
      item.externalListingId,
      item.url,
      item.status
    ].map((part) => part ?? "").join(":");
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => item);
}

function comparableAttributes(value: ReturnType<typeof blingAttributeIdentity>) {
  const attributes: Partial<ReturnType<typeof blingAttributeIdentity>> = { ...value };
  delete attributes.storeLinks;
  delete attributes.storeLinksComplete;
  delete attributes.status;
  delete attributes.externalStatus;
  return attributes;
}

export async function collectMappedBlingProductChanges(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    connectionId: string;
    productId: string;
    product: NormalizedBlingProduct;
  }
) {
  const [current, latestPrice, inventory, currentImages] = await Promise.all([
    transaction.product.findFirst({
      where: { id: input.productId, organizationId: input.organizationId },
      select: {
        id: true,
        sku: true,
        ean: true,
        packagingGtin: true,
        name: true,
        description: true,
        category: true,
        brand: true,
        ncm: true,
        weight: true,
        grossWeight: true,
        height: true,
        width: true,
        depth: true,
        dimensionUnit: true,
        condition: true,
        format: true,
        productType: true,
        commercialStatus: true,
        productionType: true,
        expirationDate: true,
        freeShipping: true,
        volumes: true,
        itemsPerBox: true,
        attributes: true
      }
    }),
    transaction.productPrice.findFirst({
      where: { organizationId: input.organizationId, productId: input.productId },
      orderBy: { createdAt: "desc" },
      select: { salePrice: true, costPrice: true }
    }),
    transaction.inventoryBalance.findUnique({
      where: {
        productId_connectionId_warehouse: {
          productId: input.productId,
          connectionId: input.connectionId,
          warehouse: "Bling"
        }
      },
      select: { physicalQuantity: true }
    }),
    transaction.productImage.findMany({
      where: { organizationId: input.organizationId, productId: input.productId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { url: true }
    })
  ]);
  if (!current) throw new Error("O produto vinculado nao pertence a organizacao atual.");

  const changes: BlingProductSyncChange[] = [];
  const remoteDescription = input.product.description?.trim() || null;
  const remoteCategory = input.product.category?.trim() || null;
  const nextBrand = resolveProductBrandFromBling(current.brand, input.product.brand);
  const nextEan = resolveImportedGtin(input.product.gtin, current.ean);
  const nextPackagingGtin = resolveImportedGtin(
    input.product.packagingGtin,
    current.packagingGtin
  );
  if (input.product.name !== current.name) {
    addSyncChange(changes, "OTHER", "name", current.name, input.product.name);
  }
  if (remoteDescription !== null && remoteDescription !== current.description) {
    addSyncChange(changes, "DESCRIPTION", "description", "anterior", "atualizado");
  }
  if (remoteCategory !== null && remoteCategory !== current.category) {
    addSyncChange(changes, "CATEGORY", "category", current.category, remoteCategory);
  }
  if (nextBrand !== current.brand) {
    addSyncChange(changes, "BRAND", "brand", current.brand, nextBrand);
  }
  if (nextEan !== current.ean) addSyncChange(changes, "GTIN", "gtin", current.ean, nextEan);
  if (nextPackagingGtin !== current.packagingGtin) {
    addSyncChange(
      changes,
      "GTIN",
      "packagingGtin",
      current.packagingGtin,
      nextPackagingGtin
    );
  }

  for (const [field, before, after] of [
    ["weight", current.weight, input.product.weight],
    ["grossWeight", current.grossWeight, input.product.grossWeight]
  ] as const) {
    if (after !== null && !sameNullableNumber(before, after)) {
      addSyncChange(changes, "WEIGHT", field, before === null ? null : Number(before), after);
    }
  }
  for (const [field, before, after] of [
    ["height", current.height, input.product.height],
    ["width", current.width, input.product.width],
    ["depth", current.depth, input.product.depth]
  ] as const) {
    if (after !== null && !sameNullableNumber(before, after)) {
      addSyncChange(changes, "DIMENSIONS", field, before === null ? null : Number(before), after);
    }
  }
  if (
    input.product.dimensionUnit !== null
    && input.product.dimensionUnit !== current.dimensionUnit
  ) {
    addSyncChange(
      changes,
      "DIMENSIONS",
      "dimensionUnit",
      current.dimensionUnit,
      input.product.dimensionUnit
    );
  }
  if (
    input.product.commercialStatus !== null
    && input.product.commercialStatus !== current.commercialStatus
  ) {
    addSyncChange(
      changes,
      "STATUS",
      "commercialStatus",
      current.commercialStatus,
      input.product.commercialStatus
    );
  }
  const remoteNcm = input.product.ncm?.trim() || null;
  if (remoteNcm !== null && remoteNcm !== current.ncm) {
    addSyncChange(changes, "ATTRIBUTES", "ncm", current.ncm, remoteNcm);
  }
  for (const [field, before, after] of [
    ["condition", current.condition, input.product.condition],
    ["format", current.format, input.product.format],
    ["productType", current.productType, input.product.productType],
    ["productionType", current.productionType, input.product.productionType],
    ["freeShipping", current.freeShipping, input.product.freeShipping],
    ["volumes", current.volumes, input.product.volumes]
  ] as const) {
    if (after !== null && after !== before) {
      addSyncChange(changes, "ATTRIBUTES", field, before, after);
    }
  }
  if (
    input.product.itemsPerBox !== null
    && !sameNullableNumber(current.itemsPerBox, input.product.itemsPerBox)
  ) {
    addSyncChange(
      changes,
      "ATTRIBUTES",
      "itemsPerBox",
      current.itemsPerBox === null ? null : Number(current.itemsPerBox),
      input.product.itemsPerBox
    );
  }
  if (
    input.product.expirationDate !== null
    && (current.expirationDate?.toISOString().slice(0, 10) ?? null)
      !== input.product.expirationDate.toISOString().slice(0, 10)
  ) {
    addSyncChange(
      changes,
      "ATTRIBUTES",
      "expirationDate",
      current.expirationDate,
      input.product.expirationDate
    );
  }

  const currentAttributeIdentity = blingAttributeIdentity(
    current.attributes,
    input.connectionId
  );
  const nextAttributes = mergeBlingProductAttributes(
    current.attributes,
    input.product,
    input.connectionId
  );
  const nextAttributeIdentity = blingAttributeIdentity(nextAttributes, input.connectionId);
  if (currentAttributeIdentity.status !== nextAttributeIdentity.status) {
    addSyncChange(
      changes,
      "STATUS",
      "blingStatus",
      currentAttributeIdentity.status,
      nextAttributeIdentity.status
    );
  }
  if (
    JSON.stringify(comparableAttributes(currentAttributeIdentity))
    !== JSON.stringify(comparableAttributes(nextAttributeIdentity))
    && !changes.some((change) => change.category === "ATTRIBUTES")
  ) {
    addSyncChange(changes, "ATTRIBUTES", "attributes", "anterior", "atualizado");
  }
  if (
    JSON.stringify(currentAttributeIdentity.storeLinks)
    !== JSON.stringify(nextAttributeIdentity.storeLinks)
  ) {
    addSyncChange(
      changes,
      "STORES",
      "stores",
      storeLinksReportValue(currentAttributeIdentity.storeLinks as NormalizedBlingStoreLink[]),
      storeLinksReportValue(nextAttributeIdentity.storeLinks as NormalizedBlingStoreLink[]),
      undefined,
      {
        previousValue: currentAttributeIdentity.storeLinks,
        newValue: nextAttributeIdentity.storeLinks
      }
    );
  }
  const currentMarketplaces = readBlingProductMarketplaceStores(
    current.attributes,
    input.connectionId
  );
  const nextMarketplaces = readBlingProductMarketplaceStores(nextAttributes, input.connectionId);
  if (JSON.stringify(currentMarketplaces) !== JSON.stringify(nextMarketplaces)) {
    addSyncChange(
      changes,
      "MARKETPLACES",
      "marketplaces",
      currentMarketplaces.mercadoLivre,
      nextMarketplaces.mercadoLivre
    );
  }

  const currentSalePrice = latestPrice ? Number(latestPrice.salePrice) : null;
  const currentCostPrice = latestPrice ? Number(latestPrice.costPrice) : null;
  if (input.product.price !== null && input.product.price !== currentSalePrice) {
    addSyncChange(changes, "PRICE", "salePrice", currentSalePrice, input.product.price);
  }
  if (input.product.costPrice !== null && input.product.costPrice !== currentCostPrice) {
    addSyncChange(changes, "PRICE", "costPrice", currentCostPrice, input.product.costPrice);
  }
  if (
    input.product.stock !== null
    && input.product.stock !== (inventory?.physicalQuantity ?? null)
  ) {
    addSyncChange(
      changes,
      "STOCK",
      "stock",
      inventory?.physicalQuantity ?? null,
      input.product.stock
    );
  }
  const existingImages = new Set(
    normalizeBlingProductImages(currentImages.map((image) => image.url))
  );
  const missingImages = normalizeBlingProductImages(input.product.images).filter(
    (url) => !existingImages.has(url)
  );
  if (missingImages.length) {
    const nextImages = [...existingImages, ...missingImages];
    addSyncChange(
      changes,
      "IMAGES",
      "images",
      currentImages.length,
      currentImages.length + missingImages.length,
      missingImages.length,
      { previousValue: [...existingImages], newValue: nextImages }
    );
  }
  return {
    productId: current.id,
    sku: current.sku || input.product.sku || "Sem SKU",
    localSku: current.sku,
    externalCode: input.product.sku,
    changes
  };
}

function blingAttributeIdentity(
  value: Prisma.JsonValue | Prisma.InputJsonValue | null,
  connectionId: string
) {
  const bling = readBlingProductConnectionAttributes(value, connectionId);
  return {
    externalProductId: text(bling.externalProductId) || null,
    parentExternalProductId: text(bling.parentExternalProductId) || null,
    sku: text(bling.sku) || null,
    connectionId: text(bling.connectionId) || null,
    status: text(bling.status) || null,
    externalStatus: text(bling.externalStatus) || null,
    format: text(bling.format) || null,
    productType: text(bling.productType) || null,
    commercialStatus: text(bling.commercialStatus) || null,
    productionType: text(bling.productionType) || null,
    shortDescription: text(bling.shortDescription) || null,
    unit: text(bling.unit) || null,
    origin: text(bling.origin) || null,
    categoryId: text(bling.categoryId) || null,
    storeLinks: normalizedStoreLinks(bling.storeLinks),
    storeLinksComplete: bling.storeLinksComplete === true,
    source: text(bling.source) || null
  };
}

function nextProgress(
  current: BlingProductImportProgress,
  status: BlingProductImportItemStatus,
  amount = 1
) {
  const next = { ...current, processed: current.processed + amount };
  if (status === "CREATED") next.created += amount;
  else if (status === "UPDATED") next.updated += amount;
  else if (status === "LINKED_BY_SKU") next.linkedBySku += amount;
  else if (status === "LINKED_BY_GTIN") next.linkedByGtin += amount;
  else if (status === "NO_CHANGES") next.noChanges += amount;
  else if (status === "NEEDS_REVIEW") next.needsReview += amount;
  else if (status === "INVALID") next.invalid += amount;
  else next.failed += amount;
  return next;
}

function jobCounterUpdate(status: BlingProductImportItemStatus, amount = 1) {
  return {
    totalFetched: { increment: amount },
    ...(status === "CREATED" ? { totalCreatedDrafts: { increment: amount } } : {}),
    ...(status === "UPDATED" ? { totalUpdatedDrafts: { increment: amount } } : {}),
    ...(["LINKED_BY_SKU", "LINKED_BY_GTIN", "NO_CHANGES", "NEEDS_REVIEW"].includes(status)
      ? { totalExistingProducts: { increment: amount } }
      : {}),
    ...(["INVALID", "FAILED"].includes(status)
      ? { totalErrors: { increment: amount } }
      : {})
  };
}

async function persistItemProgress(input: {
  transaction: Prisma.TransactionClient;
  jobId: string;
  cursor: BlingProductImportJobCursor;
  status: BlingProductImportItemStatus;
  amount?: number;
  advanceItems?: number;
  invalidRowsRecorded?: boolean;
  syncReportItem?: BlingProductSyncReportItem;
  syncFailure?: { productId: string | null; sku: string; message: string };
}) {
  const amount = input.amount ?? 1;
  const progress = nextProgress(input.cursor.progress, input.status, amount);
  const cursor = {
    ...input.cursor,
    progress,
    itemIndex: input.cursor.itemIndex + (input.advanceItems ?? amount),
    invalidRowsRecorded:
      input.invalidRowsRecorded ?? input.cursor.invalidRowsRecorded,
    ...((input.syncReportItem || input.syncFailure)
      ? {
          syncReport: input.syncFailure
            ? appendBlingProductSyncFailure(input.cursor.syncReport, input.syncFailure)
            : appendBlingProductSyncReport(input.cursor.syncReport, input.syncReportItem!)
        }
      : {})
  };
  await input.transaction.erpSyncJob.update({
    where: { id: input.jobId },
    data: {
      ...jobCounterUpdate(input.status, amount),
      lastCursor: JSON.stringify(cursor)
    }
  });
  return cursor;
}

async function upsertImportDraft(
  transaction: Prisma.TransactionClient,
  product: NormalizedBlingProduct,
  organizationId: string,
  erpConnectionId: string,
  connectionId: string,
  importStatus: BlingProductImportItemStatus
) {
  const data = draftData(product, organizationId, erpConnectionId, connectionId);
  return transaction.blingProductImportDraft.upsert({
    where: {
      organizationId_blingConnectionId_externalId: {
        organizationId,
        blingConnectionId: connectionId,
        externalId: product.externalProductId
      }
    },
    create: { ...data, importStatus },
    update: { ...data, importStatus }
  });
}

async function resolveMatchInTransaction(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    connectionId: string;
    product: NormalizedBlingProduct;
  }
) {
  const mapping = await transaction.productExternalMapping.findFirst({
    where: {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      externalProductId: input.product.externalProductId
    },
    select: { id: true, productId: true }
  });
  if (mapping) {
    return {
      mappingId: mapping.id,
      match: resolveBlingProductImportMatch({
        mappedProductId: mapping.productId,
        sku: input.product.sku,
        gtin: input.product.gtin
      })
    };
  }

  const sku = input.product.sku?.trim() || null;
  const skuCandidates = sku
    ? await transaction.product.findMany({
        where: { organizationId: input.organizationId, sku },
        select: { id: true },
        take: 2
      })
    : [];
  const normalizedGtin = normalizeGtin(input.product.gtin);
  const gtinCandidates =
    skuCandidates.length === 0
    && normalizedGtin
    && isValidGtin(normalizedGtin)
      ? await transaction.product.findMany({
          where: { organizationId: input.organizationId, ean: normalizedGtin },
          select: { id: true },
          take: 2
        })
      : [];

  return {
    mappingId: null,
    match: resolveBlingProductImportMatch({
      sku,
      gtin: normalizedGtin,
      skuCandidates,
      gtinCandidates
    })
  };
}

export async function applyMappedBlingProductSync(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    connectionId: string;
    productId: string;
    product: NormalizedBlingProduct;
  }
) {
  const current = await transaction.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: {
      id: true,
      sku: true,
      ean: true,
      packagingGtin: true,
      name: true,
      description: true,
      category: true,
      brand: true,
      ncm: true,
      weight: true,
      grossWeight: true,
      height: true,
      width: true,
      depth: true,
      dimensionUnit: true,
      condition: true,
      format: true,
      productType: true,
      commercialStatus: true,
      productionType: true,
      expirationDate: true,
      freeShipping: true,
      volumes: true,
      itemsPerBox: true,
      source: true,
      attributes: true
    }
  });
  if (!current) throw new Error("O produto vinculado nao pertence a organizacao atual.");

  const nextEan = resolveImportedGtin(input.product.gtin, current.ean);
  const nextPackagingGtin = resolveImportedGtin(
    input.product.packagingGtin,
    current.packagingGtin
  );
  const nextBrand = resolveProductBrandFromBling(current.brand, input.product.brand);
  const update: Prisma.ProductUncheckedUpdateInput = {};
  if (nextEan !== current.ean) update.ean = nextEan;
  if (nextPackagingGtin !== current.packagingGtin) {
    update.packagingGtin = nextPackagingGtin;
  }
  if (input.product.name !== current.name) update.name = input.product.name;
  const remoteDescription = input.product.description?.trim() || null;
  if (remoteDescription !== null && remoteDescription !== current.description) {
    update.description = remoteDescription;
  }
  const remoteCategory = input.product.category?.trim() || null;
  if (remoteCategory !== null && remoteCategory !== current.category) {
    update.category = remoteCategory;
  }
  if (nextBrand !== current.brand) update.brand = nextBrand;
  const remoteNcm = input.product.ncm?.trim() || null;
  if (remoteNcm !== null && remoteNcm !== current.ncm) {
    update.ncm = remoteNcm;
  }
  if (
    input.product.weight !== null
    && !sameNullableNumber(current.weight, input.product.weight)
  ) {
    update.weight = input.product.weight;
  }
  if (
    input.product.grossWeight !== null
    && !sameNullableNumber(current.grossWeight, input.product.grossWeight)
  ) {
    update.grossWeight = input.product.grossWeight;
  }
  if (
    input.product.height !== null
    && !sameNullableNumber(current.height, input.product.height)
  ) {
    update.height = input.product.height;
  }
  if (
    input.product.width !== null
    && !sameNullableNumber(current.width, input.product.width)
  ) {
    update.width = input.product.width;
  }
  if (
    input.product.depth !== null
    && !sameNullableNumber(current.depth, input.product.depth)
  ) {
    update.depth = input.product.depth;
  }
  if (
    input.product.dimensionUnit !== null
    && current.dimensionUnit !== input.product.dimensionUnit
  ) {
    update.dimensionUnit = input.product.dimensionUnit;
  }
  if (
    input.product.condition !== null
    && current.condition !== input.product.condition
  ) {
    update.condition = input.product.condition;
  }
  if (input.product.format !== null && current.format !== input.product.format) {
    update.format = input.product.format;
  }
  if (
    input.product.productType !== null
    && current.productType !== input.product.productType
  ) {
    update.productType = input.product.productType;
  }
  if (
    input.product.commercialStatus !== null
    && current.commercialStatus !== input.product.commercialStatus
  ) {
    update.commercialStatus = input.product.commercialStatus;
  }
  if (
    input.product.productionType !== null
    && current.productionType !== input.product.productionType
  ) {
    update.productionType = input.product.productionType;
  }
  if (
    input.product.expirationDate !== null
    &&
    (current.expirationDate?.toISOString().slice(0, 10) ?? null)
    !== (input.product.expirationDate?.toISOString().slice(0, 10) ?? null)
  ) {
    update.expirationDate = input.product.expirationDate;
  }
  if (
    input.product.freeShipping !== null
    && current.freeShipping !== input.product.freeShipping
  ) {
    update.freeShipping = input.product.freeShipping;
  }
  if (input.product.volumes !== null && current.volumes !== input.product.volumes) {
    update.volumes = input.product.volumes;
  }
  if (
    input.product.itemsPerBox !== null
    && !sameNullableNumber(current.itemsPerBox, input.product.itemsPerBox)
  ) {
    update.itemsPerBox = input.product.itemsPerBox;
  }
  if (current.source !== "BLING") update.source = "BLING";

  const nextAttributes = mergeBlingProductAttributes(
    current.attributes,
    input.product,
    input.connectionId
  );
  if (
    JSON.stringify(blingAttributeIdentity(current.attributes, input.connectionId))
    !== JSON.stringify(blingAttributeIdentity(nextAttributes, input.connectionId))
  ) {
    update.attributes = nextAttributes;
  }

  const productChanged = Object.keys(update).length > 0;
  if (productChanged) {
    await transaction.product.update({
      where: { id: current.id },
      data: update
    });
  }
  const priceChanged = await updateLocalPrice(
    transaction,
    input.organizationId,
    current.id,
    input.product
  );
  const inventoryChanged = await updateLocalInventory(
    transaction,
    input.organizationId,
    input.connectionId,
    current.id,
    input.product.stock
  );
  const imagesChanged = await appendMissingBlingProductImages(
    transaction,
    input.organizationId,
    current.id,
    input.product.images
  );
  return productChanged || priceChanged || inventoryChanged || imagesChanged;
}

export function buildImportedProductCreateData(input: {
  organizationId: string;
  connectionId: string;
  product: NormalizedBlingProduct;
  statusCheckedAt?: string;
}): Prisma.ProductUncheckedCreateInput {
  const product = input.product;
  return {
    organizationId: input.organizationId,
    sku: product.sku?.trim() || null,
    ean: resolveImportedGtin(product.gtin),
    packagingGtin: resolveImportedGtin(product.packagingGtin),
    name: product.name,
    description: product.description,
    category: product.category,
    brand: normalizeProductBrand(product.brand),
    ncm: product.ncm,
    status: "DRAFT",
    enrichmentStatus: "IMPORTED",
    syncStatus: "NOT_SYNCED",
    source: "BLING",
    weight: product.weight,
    grossWeight: product.grossWeight,
    height: product.height,
    width: product.width,
    depth: product.depth,
    dimensionUnit: product.dimensionUnit,
    condition: product.condition,
    format: product.format,
    productType: product.productType,
    commercialStatus: product.commercialStatus,
    productionType: product.productionType,
    expirationDate: product.expirationDate,
    freeShipping: product.freeShipping,
    volumes: product.volumes,
    itemsPerBox: product.itemsPerBox,
    attributes: mergeBlingProductAttributes(
      null,
      product,
      input.connectionId,
      input.statusCheckedAt
    )
  };
}

async function applyProduct(input: {
  operation: BlingProductJobOperation;
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  page: number;
  product: NormalizedBlingProduct;
  preliminaryMatch: BlingProductImportMatch;
  cursor: BlingProductImportJobCursor;
}) {
  if (
    input.operation === "SYNC"
    && input.preliminaryMatch.kind === "MAPPING"
    && input.preliminaryMatch.productId
  ) {
    const mappingCount = await prisma.productExternalMapping.count({
      where: {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        productId: input.preliminaryMatch.productId
      }
    });
    if (mappingCount > 1) {
      return prisma.$transaction(async (transaction) => {
        const cursor = await persistItemProgress({
          transaction,
          jobId: input.jobId,
          cursor: input.cursor,
          status: "FAILED",
          syncFailure: {
            productId: input.preliminaryMatch.productId,
            sku: input.product.sku || "Sem SKU",
            message: "O produto possui mais de um vinculo Bling e requer revisao."
          }
        });
        return { status: "FAILED" as const, cursor };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
  }
  const shouldHydrate =
    (input.operation === "IMPORT" && input.preliminaryMatch.kind === "CREATE")
    || (input.operation === "SYNC" && input.preliminaryMatch.kind === "MAPPING");
  const product = shouldHydrate
    ? await hydrateBlingProductForPersistence({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        product: input.product
      })
    : input.product;

  return prisma.$transaction(async (transaction) => {
    const resolved = await resolveMatchInTransaction(transaction, {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      product
    });
    if (
      (input.operation === "IMPORT" && resolved.match.kind === "MAPPING")
      || (input.operation === "SYNC" && resolved.match.kind !== "MAPPING")
    ) {
      const cursor = await persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor: input.cursor,
        status: "NO_CHANGES"
      });
      return { status: "NO_CHANGES" as const, cursor };
    }
    if (resolved.match.kind === "NEEDS_REVIEW") {
      if (input.operation === "IMPORT") {
        await upsertImportDraft(
          transaction,
          product,
          input.organizationId,
          input.erpConnectionId,
          input.connectionId,
          "NEEDS_REVIEW"
        );
      }
      const cursor = await persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor: input.cursor,
        status: "NEEDS_REVIEW"
      });
      return { status: "NEEDS_REVIEW" as const, cursor };
    }

    if (resolved.match.kind === "CREATE") {
      const createdProduct = await transaction.product.create({
        data: buildImportedProductCreateData({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          product
        }),
        select: { id: true }
      });
      await transaction.productExternalMapping.create({
        data: {
          organizationId: input.organizationId,
          productId: createdProduct.id,
          connectionId: input.connectionId,
          externalProductId: input.product.externalProductId,
          lastExternalSyncAt: new Date()
        }
      });
      await updateLocalPrice(transaction, input.organizationId, createdProduct.id, product);
      await updateLocalInventory(
        transaction,
        input.organizationId,
        input.connectionId,
        createdProduct.id,
        product.stock
      );
      await appendMissingBlingProductImages(
        transaction,
        input.organizationId,
        createdProduct.id,
        product.images
      );
      await upsertImportDraft(
        transaction,
        product,
        input.organizationId,
        input.erpConnectionId,
        input.connectionId,
        "CREATED"
      );
      const cursor = await persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor: input.cursor,
        status: "CREATED"
      });
      return { status: "CREATED" as const, cursor };
    }

    if (!resolved.match.productId) throw new Error("Identidade local do produto nao foi resolvida.");
    const syncAnalysis = input.operation === "SYNC"
      ? await collectMappedBlingProductChanges(transaction, {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          productId: resolved.match.productId,
          product
        })
      : null;
    const changed = input.operation === "SYNC"
      ? await applyMappedBlingProductSync(transaction, {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          productId: resolved.match.productId,
          product
        })
      : false;

    let status: BlingProductImportItemStatus;
    if (resolved.match.kind === "SKU") status = "LINKED_BY_SKU";
    else if (resolved.match.kind === "GTIN") status = "LINKED_BY_GTIN";
    else status = changed ? "UPDATED" : "NO_CHANGES";

    if (resolved.match.kind === "SKU" || resolved.match.kind === "GTIN") {
      await transaction.productExternalMapping.create({
        data: {
          organizationId: input.organizationId,
          productId: resolved.match.productId,
          connectionId: input.connectionId,
          externalProductId: input.product.externalProductId,
          lastExternalSyncAt: new Date()
        }
      });
    } else if (resolved.mappingId) {
      await transaction.productExternalMapping.update({
        where: { id: resolved.mappingId },
        data: { lastExternalSyncAt: new Date() }
      });
    }
    if (input.operation === "IMPORT") {
      await upsertImportDraft(
        transaction,
        product,
        input.organizationId,
        input.erpConnectionId,
        input.connectionId,
        status
      );
    }
    const syncChanges = changed && syncAnalysis?.changes.length === 0
      ? [{
          category: "OTHER" as const,
          field: "product",
          previousValue: "anterior",
          newValue: "atualizado"
        }]
      : syncAnalysis?.changes ?? [];
    const cursor = await persistItemProgress({
      transaction,
      jobId: input.jobId,
      cursor: input.cursor,
      status,
      ...(input.operation === "SYNC" && changed && syncAnalysis
        ? {
            syncReportItem: {
              productId: syncAnalysis.productId,
              sku: syncAnalysis.sku,
              localSku: syncAnalysis.localSku,
              externalCode: syncAnalysis.externalCode,
              changes: syncChanges
            }
          }
        : {})
    });
    return { status, cursor };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function recordFailedProduct(input: {
  operation: BlingProductJobOperation;
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  product: NormalizedBlingProduct;
  preliminaryMatch: BlingProductImportMatch | undefined;
  error: unknown;
  cursor: BlingProductImportJobCursor;
}) {
  return prisma.$transaction(async (transaction) => {
    if (input.operation === "IMPORT") {
      await upsertImportDraft(
        transaction,
        input.product,
        input.organizationId,
        input.erpConnectionId,
        input.connectionId,
        "FAILED"
      );
    }
    return persistItemProgress({
      transaction,
      jobId: input.jobId,
      cursor: input.cursor,
      status: "FAILED",
      ...(input.operation === "SYNC"
        ? {
            syncFailure: {
              productId: input.preliminaryMatch?.productId ?? null,
              sku: input.product.sku || "Sem SKU",
              message: input.error instanceof BlingApiError
                ? "Nao foi possivel consultar este produto no Bling."
                : "Nao foi possivel sincronizar este produto."
            }
          }
        : {})
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function applyPage(input: {
  operation: BlingProductJobOperation;
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  page: number;
  products: NormalizedBlingProduct[];
  matches: Map<string, BlingProductImportMatch>;
  invalidRows: number;
  cursor: BlingProductImportJobCursor;
}) {
  let cursor = await processBlingImportItemsIndependently({
    items: input.products.slice(input.cursor.itemIndex),
    initialState: input.cursor,
    processItem: async (product, currentCursor) => {
      const preliminaryMatch = input.matches.get(product.externalProductId);
      if (!preliminaryMatch) {
        throw new Error("A classificacao preliminar do produto nao foi encontrada.");
      }
      const result = await applyProduct({
        operation: input.operation,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        erpConnectionId: input.erpConnectionId,
        jobId: input.jobId,
        page: input.page,
        product,
        preliminaryMatch,
        cursor: currentCursor
      });
      return result.cursor;
    },
    recordFailure: (product, currentCursor, error) =>
      recordFailedProduct({
        operation: input.operation,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        erpConnectionId: input.erpConnectionId,
        jobId: input.jobId,
        product,
        preliminaryMatch: input.matches.get(product.externalProductId),
        error,
        cursor: currentCursor
      })
  });

  if (input.invalidRows > 0 && !cursor.invalidRowsRecorded) {
    cursor = await prisma.$transaction((transaction) =>
      persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor,
        status: "INVALID",
        amount: input.invalidRows,
        advanceItems: 0,
        invalidRowsRecorded: true
      })
    );
  }
  return cursor;
}

function parseBlingProductImportJobCursor(value: string | null): BlingProductImportJobCursor | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as BlingProductImportJobCursor | (Omit<BlingProductImportJobCursor, "version" | "operation" | "automatic"> & { version: 1 });
    const parsed: BlingProductImportJobCursor = raw.version === 1
      ? {
          ...raw,
          version: 2,
          operation: "IMPORT",
          automatic: false,
          itemIndex: 0,
          invalidRowsRecorded: false,
          preview: {
            ...raw.preview,
            reportedTotal: raw.preview.total,
            sourceRows: raw.progress.processed
          }
        }
      : {
          ...raw,
          itemIndex: raw.itemIndex ?? 0,
          invalidRowsRecorded: raw.invalidRowsRecorded ?? false
        };
    if (
      parsed.version !== 2
      || !["IMPORT", "SYNC"].includes(parsed.operation)
      || typeof parsed.automatic !== "boolean"
      || !Array.isArray(parsed.preview?.pageCounts)
      || !parsed.preview.pageCounts.every(validNonNegativeInteger)
      || !validNonNegativeInteger(parsed.preview.total)
      || (
        parsed.preview.reportedTotal !== null
        && !validNonNegativeInteger(parsed.preview.reportedTotal)
      )
      || !validNonNegativeInteger(parsed.preview.sourceRows)
      || !parsed.preview.summary
      || !Object.values(parsed.preview.summary).every(validNonNegativeInteger)
      || !parsed.progress
      || !Object.values(parsed.progress).every(validNonNegativeInteger)
      || !validNonNegativeInteger(parsed.page)
      || !validNonNegativeInteger(parsed.itemIndex)
      || typeof parsed.invalidRowsRecorded !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export type BlingImportPreviewProof = {
  pageSize: number;
  firstPage: number;
  lastDataPage: number;
  sentinelPage: number | null;
  pageCounts: number[];
  uniqueIdsCount: number;
  reportedTotal: number | null;
  derivedTotal: number | null;
  totalSource: BlingImportTotalSource;
  duplicateCount: number;
  invalidCount: number;
  listFingerprint: string;
};

type BlingImportPreviewFingerprintInput = BlingImportPreviewProof & {
  operation?: BlingProductJobOperation;
  correlationId: string;
  connectionId: string;
  existing: number;
  newProducts: number;
  importable: number;
  skuConflicts: number;
  matchSummary: BlingProductImportMatchSummary;
};

export function createBlingImportPreviewFingerprint(
  input: BlingImportPreviewFingerprintInput
) {
  return createHash("sha256").update(JSON.stringify({
    operation: input.operation ?? "IMPORT",
    correlationId: input.correlationId,
    connectionId: input.connectionId,
    pageSize: input.pageSize,
    firstPage: input.firstPage,
    lastDataPage: input.lastDataPage,
    sentinelPage: input.sentinelPage,
    pageCounts: input.pageCounts,
    uniqueIdsCount: input.uniqueIdsCount,
    reportedTotal: input.reportedTotal,
    derivedTotal: input.derivedTotal,
    totalSource: input.totalSource,
    duplicateCount: input.duplicateCount,
    invalidCount: input.invalidCount,
    listFingerprint: input.listFingerprint,
    existing: input.existing,
    newProducts: input.newProducts,
    importable: input.importable,
    skuConflicts: input.skuConflicts,
    matchSummary: input.matchSummary
  })).digest("hex");
}

export function createBlingImportPreviewConfirmation(
  input: {
    previewJobId: string;
    userId: string;
    organizationId: string;
    connectionId: string;
    operation?: BlingProductJobOperation;
    correlationId: string;
    previewFingerprint: string;
    proof: BlingImportPreviewProof;
    existing: number;
    newProducts: number;
    importable: number;
    skuConflicts: number;
    matchSummary: BlingProductImportMatchSummary;
  },
  now = new Date()
) {
  const recalculatedFingerprint = createBlingImportPreviewFingerprint({
    operation: input.operation ?? "IMPORT",
    correlationId: input.correlationId,
    connectionId: input.connectionId,
    ...input.proof,
    existing: input.existing,
    newProducts: input.newProducts,
    importable: input.importable,
    skuConflicts: input.skuConflicts,
    matchSummary: input.matchSummary
  });
  if (recalculatedFingerprint !== input.previewFingerprint) {
    throw new Error("A prova da previa nao corresponde ao fingerprint informado.");
  }
  const confirmation: BlingImportPreviewConfirmation = {
    version: 5,
    operation: "BLING_PRODUCT_IMPORT_PREVIEW",
    previewJobId: input.previewJobId,
    jobOperation: input.operation ?? "IMPORT",
    userId: input.userId,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    correlationId: input.correlationId,
    ...input.proof,
    existing: input.existing,
    newProducts: input.newProducts,
    importable: input.importable,
    skuConflicts: input.skuConflicts,
    matchSummary: input.matchSummary,
    previewFingerprint: input.previewFingerprint,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + previewConfirmationLifetimeMs).toISOString()
  };
  return {
    confirmationToken: encryptSecret(JSON.stringify(confirmation)),
    previewExpiresAt: confirmation.expiresAt
  };
}

type BlingPreviewConfirmationErrorCode =
  | "PREVIEW_INVALID"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_STALE"
  | "PREVIEW_USER_MISMATCH"
  | "PREVIEW_ORGANIZATION_MISMATCH"
  | "PREVIEW_CONNECTION_MISMATCH"
  | "PREVIEW_OPERATION_MISMATCH"
  | "PREVIEW_CORRELATION_MISMATCH"
  | "PREVIEW_FINGERPRINT_MISMATCH"
  | "PREVIEW_JOB_MISMATCH";

class BlingPreviewConfirmationValidationError extends Error {
  constructor(public readonly code: BlingPreviewConfirmationErrorCode) {
    super(code);
    this.name = "BlingPreviewConfirmationValidationError";
  }
}

function invalidPreviewConfirmation(
  correlationId: string,
  errorCode: BlingPreviewConfirmationErrorCode
): never {
  throw new BlingImportPreviewError(
    "A previa expirou ou nao corresponde a esta execucao.",
    {
      correlationId,
      stage: "PREPARE_SYNC",
      page: null,
      expectedPages: null,
      httpStatus: 409,
      errorCode,
      requestIdMasked: null,
      durationMs: 0,
      pageSize,
      pageCounts: [],
      pageStatuses: [],
      pagesCompleted: 0,
      lastDataPage: 0,
      sentinelPage: null,
      reportedTotal: null,
      derivedTotal: null,
      totalSource: "NONE",
      uniqueProductsLoaded: 0,
      duplicateCount: 0,
      invalidCount: 0,
      paginationComplete: false,
      previewComplete: false,
      jobCreated: false
    }
  );
}

function validNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function verifyBlingImportPreviewConfirmation(
  encrypted: string,
  input: {
    previewJobId: string;
    userId: string;
    organizationId: string;
    connectionId: string;
    operation?: BlingProductJobOperation;
    correlationId: string;
    previewFingerprint: string;
  },
  now = new Date()
) {
  try {
    const confirmation = JSON.parse(decryptSecret(encrypted)) as BlingImportPreviewConfirmation;
    const issuedAt = Date.parse(confirmation.issuedAt);
    const expiresAt = Date.parse(confirmation.expiresAt);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      throw new BlingPreviewConfirmationValidationError("PREVIEW_INVALID");
    }
    if (expiresAt <= now.getTime()) {
      throw new BlingPreviewConfirmationValidationError("PREVIEW_EXPIRED");
    }
    if (confirmation.userId !== input.userId) {
      throw new BlingPreviewConfirmationValidationError("PREVIEW_USER_MISMATCH");
    }
    if (confirmation.previewJobId !== input.previewJobId) {
      throw new BlingPreviewConfirmationValidationError("PREVIEW_JOB_MISMATCH");
    }
    if (confirmation.organizationId !== input.organizationId) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_ORGANIZATION_MISMATCH"
      );
    }
    if (confirmation.connectionId !== input.connectionId) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_CONNECTION_MISMATCH"
      );
    }
    if (confirmation.jobOperation !== (input.operation ?? "IMPORT")) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_OPERATION_MISMATCH"
      );
    }
    if (confirmation.correlationId !== input.correlationId) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_CORRELATION_MISMATCH"
      );
    }
    if (confirmation.previewFingerprint !== input.previewFingerprint) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_FINGERPRINT_MISMATCH"
      );
    }
    const validTotalSource = [
      "RESPONSE",
      "HEADER",
      "DERIVED_SHORT_PAGE",
      "DERIVED_EMPTY_SENTINEL"
    ].includes(confirmation.totalSource);
    const validPageCounts =
      Array.isArray(confirmation.pageCounts)
      && confirmation.pageCounts.length > 0
      && confirmation.pageCounts.length <= maxSafetyPages
      && confirmation.pageCounts.every((count) =>
        validNonNegativeInteger(count) && count <= confirmation.pageSize
      );
    const proofValidation = validPageCounts
      ? validateBlingImportPreviewProof({
          pageSize: confirmation.pageSize,
          firstPage: confirmation.firstPage,
          lastDataPage: confirmation.lastDataPage,
          sentinelPage: confirmation.sentinelPage,
          pageCounts: confirmation.pageCounts,
          uniqueIdsCount: confirmation.uniqueIdsCount,
          reportedTotal: confirmation.reportedTotal,
          derivedTotal: confirmation.derivedTotal,
          totalSource: confirmation.totalSource,
          duplicateCount: confirmation.duplicateCount,
          invalidCount: confirmation.invalidCount
        })
      : null;
    const validMatchSummary =
      Boolean(confirmation.matchSummary)
      && Object.values(confirmation.matchSummary).every(validNonNegativeInteger)
      && confirmation.matchSummary.updatedByMapping
        + confirmation.matchSummary.linkedBySku
        + confirmation.matchSummary.linkedByGtin
        + confirmation.matchSummary.created
        + confirmation.matchSummary.needsReview === confirmation.uniqueIdsCount
      && confirmation.existing === confirmation.matchSummary.updatedByMapping
      && confirmation.newProducts === (
        confirmation.jobOperation === "IMPORT"
          ? confirmation.matchSummary.created
          : 0
      )
      && confirmation.importable === (
        confirmation.jobOperation === "IMPORT"
          ? confirmation.matchSummary.linkedBySku
            + confirmation.matchSummary.linkedByGtin
            + confirmation.matchSummary.created
          : confirmation.matchSummary.updatedByMapping
      )
      && confirmation.skuConflicts === confirmation.matchSummary.skuConflicts
      && confirmation.matchSummary.skuConflicts
        + confirmation.matchSummary.gtinConflicts === confirmation.matchSummary.needsReview;
    const recalculatedFingerprint = createBlingImportPreviewFingerprint({
      operation: confirmation.jobOperation,
      correlationId: confirmation.correlationId,
      connectionId: confirmation.connectionId,
      pageSize: confirmation.pageSize,
      firstPage: confirmation.firstPage,
      lastDataPage: confirmation.lastDataPage,
      sentinelPage: confirmation.sentinelPage,
      pageCounts: confirmation.pageCounts,
      uniqueIdsCount: confirmation.uniqueIdsCount,
      reportedTotal: confirmation.reportedTotal,
      derivedTotal: confirmation.derivedTotal,
      totalSource: confirmation.totalSource,
      duplicateCount: confirmation.duplicateCount,
      invalidCount: confirmation.invalidCount,
      listFingerprint: confirmation.listFingerprint,
      existing: confirmation.existing,
      newProducts: confirmation.newProducts,
      importable: confirmation.importable,
      skuConflicts: confirmation.skuConflicts,
      matchSummary: confirmation.matchSummary
    });
    if (recalculatedFingerprint !== input.previewFingerprint) {
      throw new BlingPreviewConfirmationValidationError(
        "PREVIEW_FINGERPRINT_MISMATCH"
      );
    }
    if (
      confirmation.version !== 5
      || confirmation.operation !== "BLING_PRODUCT_IMPORT_PREVIEW"
      || !confirmation.previewJobId
      || !["IMPORT", "SYNC"].includes(confirmation.jobOperation)
      || !validNonNegativeInteger(confirmation.pageSize)
      || confirmation.pageSize <= 0
      || confirmation.firstPage !== 1
      || !validNonNegativeInteger(confirmation.lastDataPage)
      || (
        confirmation.sentinelPage !== null
        && !validNonNegativeInteger(confirmation.sentinelPage)
      )
      || !validPageCounts
      || !validNonNegativeInteger(confirmation.uniqueIdsCount)
      || !validNonNegativeInteger(confirmation.duplicateCount)
      || !validNonNegativeInteger(confirmation.invalidCount)
      || confirmation.duplicateCount !== 0
      || !validMatchSummary
      || !validTotalSource
      || proofValidation?.proofMatches !== true
      || !/^[a-f0-9]{64}$/.test(confirmation.listFingerprint)
      || expiresAt - issuedAt !== previewConfirmationLifetimeMs
    ) {
      throw new BlingPreviewConfirmationValidationError("PREVIEW_INVALID");
    }
    return confirmation;
  } catch (error) {
    return invalidPreviewConfirmation(
      input.correlationId,
      error instanceof BlingPreviewConfirmationValidationError
        ? error.code
        : "PREVIEW_INVALID"
    );
  }
}

async function loadMappedBlingProductsForSync(
  organizationId: string,
  connectionId: string
) {
  const rows = await prisma.productExternalMapping.findMany({
    where: { organizationId, connectionId },
    orderBy: [{ externalProductId: "asc" }, { id: "asc" }],
    select: {
      externalProductId: true,
      productId: true,
      product: {
        select: {
          name: true,
          sku: true,
          ean: true,
          packagingGtin: true,
          description: true,
          category: true,
          brand: true,
          ncm: true,
          weight: true,
          grossWeight: true,
          height: true,
          width: true,
          depth: true,
          dimensionUnit: true,
          condition: true,
          format: true,
          productType: true,
          commercialStatus: true,
          productionType: true,
          expirationDate: true,
          freeShipping: true,
          volumes: true,
          itemsPerBox: true,
          attributes: true
        }
      }
    }
  });
  return rows.map((row) => {
    const scoped = readBlingProductConnectionAttributes(
      row.product.attributes,
      connectionId
    );
    return {
      externalProductId: row.externalProductId,
      productId: row.productId,
      product: {
        externalProductId: row.externalProductId,
        parentExternalProductId: null,
        name: row.product.name,
        sku: row.product.sku,
        gtin: row.product.ean,
        packagingGtin: row.product.packagingGtin,
        description: row.product.description,
        shortDescription: text(scoped.shortDescription) || null,
        price: null,
        costPrice: null,
        stock: null,
        unit: text(scoped.unit) || null,
        imageUrl: null,
        images: [],
        brand: row.product.brand,
        category: row.product.category,
        categoryId: text(scoped.categoryId) || null,
        ncm: row.product.ncm,
        weight: row.product.weight === null ? null : Number(row.product.weight),
        grossWeight: row.product.grossWeight === null ? null : Number(row.product.grossWeight),
        height: row.product.height === null ? null : Number(row.product.height),
        width: row.product.width === null ? null : Number(row.product.width),
        depth: row.product.depth === null ? null : Number(row.product.depth),
        dimensionUnit: row.product.dimensionUnit,
        condition: row.product.condition,
        status: text(scoped.externalStatus) || "UNKNOWN",
        format: row.product.format,
        productType: row.product.productType,
        commercialStatus: row.product.commercialStatus,
        productionType: row.product.productionType,
        expirationDate: row.product.expirationDate,
        freeShipping: row.product.freeShipping,
        volumes: row.product.volumes,
        itemsPerBox: row.product.itemsPerBox === null ? null : Number(row.product.itemsPerBox),
        origin: text(scoped.origin) || null,
        storeLinks: list(scoped.storeLinks) as NormalizedBlingStoreLink[],
        storeLinksComplete: scoped.storeLinksComplete === true,
        isVariation: row.product.format === ProductFormat.VARIATION
      } satisfies NormalizedBlingProduct
    };
  });
}

function mappedSyncPageCounts(total: number) {
  if (total === 0) return [0];
  const counts = Array.from(
    { length: Math.ceil(total / pageSize) },
    (_, index) => Math.min(pageSize, total - (index * pageSize))
  );
  if (counts.at(-1) === pageSize) counts.push(0);
  return counts;
}

export async function ensureBlingSyncCompletionNotification(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; jobId: string }
) {
  const lockKey = `bling-sync-notification:${input.organizationId}:${input.jobId}`;
  await transaction.$queryRaw<Array<{ lockState: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
  `;
  const marker = createBlingSyncReportNotificationMarker(input.jobId);
  const existingNotification = await transaction.notification.findFirst({
    where: { organizationId: input.organizationId, message: marker },
    select: { id: true }
  });
  if (existingNotification) return existingNotification;
  return transaction.notification.create({
    data: {
      organizationId: input.organizationId,
      title: "Sincronizacao Bling concluida",
      message: marker,
      status: "UNREAD"
    }
  });
}

export async function analyzeMappedBlingProductsForSyncPreview(
  input: {
    organizationId: string;
    connectionId: string;
    products: NormalizedBlingProduct[];
    matches: Map<string, BlingProductImportMatch>;
  },
  dependencies: {
    hydrate?: (input: {
      organizationId: string;
      connectionId: string;
      product: NormalizedBlingProduct;
    }) => Promise<NormalizedBlingProduct>;
    collectChanges?: (
      transaction: Prisma.TransactionClient,
      input: {
        organizationId: string;
        connectionId: string;
        productId: string;
        product: NormalizedBlingProduct;
      }
    ) => Promise<{ sku: string; changes: BlingProductSyncChange[] }>;
    onProgress?: (progress: BlingPreviewJobProgress) => Promise<void> | void;
  } = {}
) {
  const mapped = input.products.flatMap((product) => {
    const match = input.matches.get(product.externalProductId);
    return match?.kind === "MAPPING" && match.productId
      ? [{ product, productId: match.productId }]
      : [];
  });
  const summary = {
    analyzed: mapped.length,
    withChanges: 0,
    withoutChanges: 0,
    failures: 0
  };
  const mappingCountByProduct = new Map<string, number>();
  for (const item of mapped) {
    mappingCountByProduct.set(
      item.productId,
      (mappingCountByProduct.get(item.productId) ?? 0) + 1
    );
  }
  let nextIndex = 0;
  let completedCount = 0;
  let progressQueue = Promise.resolve();
  const workerCount = Math.min(3, Math.max(1, mapped.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < mapped.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = mapped[currentIndex];
      try {
        if ((mappingCountByProduct.get(item.productId) ?? 0) > 1) {
          summary.failures += 1;
          continue;
        }
        const product = await (dependencies.hydrate ?? hydrateBlingProductForPersistence)({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          product: item.product
        });
        const result = await (dependencies.collectChanges ?? collectMappedBlingProductChanges)(
          prisma as unknown as Prisma.TransactionClient,
          {
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            productId: item.productId,
            product
          }
        );
        if (result.changes.length) summary.withChanges += 1;
        else summary.withoutChanges += 1;
      } catch {
        summary.failures += 1;
      } finally {
        completedCount += 1;
        if (dependencies.onProgress && (completedCount % 5 === 0 || completedCount === mapped.length)) {
          const snapshot = { ...summary };
          const processed = completedCount;
          progressQueue = progressQueue.then(() => dependencies.onProgress?.({
            stage: "LOCAL_COMPARISON",
            currentPage: Math.max(1, Math.ceil(processed / pageSize)),
            pagesCompleted: Math.floor(processed / pageSize),
            itemsProcessed: processed,
            totalItems: mapped.length,
            uniqueProducts: mapped.length,
            duplicateCount: 0,
            invalidCount: 0,
            withChanges: snapshot.withChanges,
            withoutChanges: snapshot.withoutChanges,
            failures: snapshot.failures,
            heartbeatAt: new Date().toISOString()
          })).then(() => undefined);
        }
      }
    }
  }));
  await progressQueue;
  return summary;
}

async function createMappedBlingSyncDryRun(input: {
  previewJobId: string;
  userId: string;
  organizationId: string;
  connectionId: string;
  correlationId: string;
  connection: { id: string; name: string };
  startedAt: number;
  onProgress?: (progress: BlingPreviewJobProgress) => Promise<void> | void;
}): Promise<BlingProductDryRun> {
  const mapped = await loadMappedBlingProductsForSync(
    input.organizationId,
    input.connectionId
  );
  const products = mapped.map((row) => row.product);
  await input.onProgress?.({
    stage: "LOCAL_COMPARISON",
    currentPage: 1,
    pagesCompleted: 0,
    itemsProcessed: 0,
    totalItems: mapped.length,
    uniqueProducts: mapped.length,
    duplicateCount: 0,
    invalidCount: 0,
    withChanges: 0,
    withoutChanges: 0,
    failures: 0,
    heartbeatAt: new Date().toISOString(),
    processedExternalIds: mapped.map((row) => row.externalProductId)
  });
  const matches = new Map<string, BlingProductImportMatch>(
    mapped.map((row) => [
      row.externalProductId,
      { kind: "MAPPING", productId: row.productId, conflictField: null }
    ])
  );
  const syncAnalysis = await analyzeMappedBlingProductsForSyncPreview(
    {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      products,
      matches
    },
    { onProgress: input.onProgress }
  );
  const pageCounts = mappedSyncPageCounts(mapped.length);
  const integrity = evaluateBlingImportPreviewIntegrity({
    totalReportedByBling: null,
    reportedTotalSource: "NONE",
    sourceRowsFetched: mapped.length,
    completedPages: pageCounts.map((_, index) => index + 1),
    pageCounts,
    pageStatuses: pageCounts.map(() => 200),
    terminated: true,
    totalChangedDuringFetch: false,
    invalidRows: 0,
    duplicateExternalIds: 0,
    uniqueProductsLoaded: mapped.length,
    pageSize
  });
  if (!integrity.previewComplete) {
    throw new BlingImportPreviewError(
      "A lista de produtos vinculados nao passou pelas verificacoes de integridade.",
      previewFailureDiagnostic({
        correlationId: input.correlationId,
        stage: "LOCAL_COMPARISON",
        startedAt: input.startedAt,
        errorCode: integrity.reasons[0] ?? "PREVIEW_INCOMPLETE",
        pageCounts,
        pagesCompleted: pageCounts.length,
        lastDataPage: integrity.lastDataPage,
        sentinelPage: integrity.sentinelPage,
        derivedTotal: integrity.derivedTotal,
        totalSource: integrity.totalSource,
        uniqueProductsLoaded: mapped.length,
        paginationComplete: integrity.paginationComplete,
        previewComplete: false,
        jobCreated: false
      })
    );
  }
  const listFingerprint = createHash("sha256")
    .update(JSON.stringify(mapped.map((row) => row.externalProductId)))
    .digest("hex");
  const matchSummary: BlingProductImportMatchSummary = {
    ...emptyMatchSummary(),
    updatedByMapping: mapped.length
  };
  const proof: BlingImportPreviewProof = {
    pageSize,
    firstPage: integrity.firstPage,
    lastDataPage: integrity.lastDataPage,
    sentinelPage: integrity.sentinelPage,
    pageCounts,
    uniqueIdsCount: mapped.length,
    reportedTotal: null,
    derivedTotal: integrity.derivedTotal,
    totalSource: integrity.totalSource,
    duplicateCount: 0,
    invalidCount: 0,
    listFingerprint
  };
  const previewFingerprint = createBlingImportPreviewFingerprint({
    operation: "SYNC",
    correlationId: input.correlationId,
    connectionId: input.connectionId,
    ...proof,
    existing: mapped.length,
    newProducts: 0,
    importable: mapped.length,
    skuConflicts: 0,
    matchSummary
  });
  const confirmation = createBlingImportPreviewConfirmation({
    previewJobId: input.previewJobId,
    userId: input.userId,
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    operation: "SYNC",
    correlationId: input.correlationId,
    previewFingerprint,
    proof,
    existing: mapped.length,
    newProducts: 0,
    importable: mapped.length,
    skuConflicts: 0,
    matchSummary
  });
  return {
    operation: "SYNC",
    connectionReady: true,
    connectionId: input.connection.id,
    connectionName: input.connection.name,
    correlationId: input.correlationId,
    reportedTotal: null,
    derivedTotal: integrity.derivedTotal,
    totalSource: integrity.totalSource,
    totalReportedByBling: null,
    totalFound: mapped.length,
    pagesFound: pageCounts.filter((count) => count > 0).length,
    pagesCompleted: pageCounts.length,
    pagesExpected: integrity.pagesExpected,
    pageSize,
    firstPage: integrity.firstPage,
    lastDataPage: integrity.lastDataPage,
    sentinelPage: integrity.sentinelPage,
    pageCounts,
    uniqueProductsLoaded: mapped.length,
    uniqueIdsCount: mapped.length,
    simpleProducts: products.filter((product) => !product.isVariation).length,
    variations: products.filter((product) => product.isVariation).length,
    active: products.filter((product) => product.commercialStatus === ProductCommercialStatus.ACTIVE).length,
    inactive: products.filter((product) => product.commercialStatus !== ProductCommercialStatus.ACTIVE).length,
    withoutSku: products.filter((product) => !product.sku).length,
    withoutGtin: products.filter((product) => {
      const gtin = normalizeGtin(product.gtin);
      return !gtin || !isValidGtin(gtin);
    }).length,
    existing: mapped.length,
    new: 0,
    wouldUpdate: syncAnalysis.withChanges,
    syncAnalyzed: syncAnalysis.analyzed,
    syncWithChanges: syncAnalysis.withChanges,
    syncWithoutChanges: syncAnalysis.withoutChanges,
    syncFailures: syncAnalysis.failures,
    importable: mapped.length,
    updatedByMapping: mapped.length,
    linkedBySku: 0,
    linkedByGtin: 0,
    wouldCreate: 0,
    needsReview: 0,
    invalid: 0,
    errors: syncAnalysis.failures,
    ignored: 0,
    duplicateExternalIds: 0,
    skuConflicts: 0,
    gtinConflicts: 0,
    completed: true,
    paginationComplete: true,
    previewComplete: true,
    listFingerprint,
    previewFingerprint,
    previewExpiresAt: confirmation.previewExpiresAt,
    confirmationToken: confirmation.confirmationToken,
    warnings: syncAnalysis.failures
      ? [`${syncAnalysis.failures} produto(s) nao puderam ser comparados na previa.`]
      : [],
    durationMs: Math.max(0, Date.now() - input.startedAt),
    writesPerformed: false
  };
}

export class BlingProductImportService {
  async scheduleInitialImport(input: {
    organizationId: string;
    connectionId: string;
  }) {
    const connection = await validateBlingProductImportConnection(
      input.organizationId,
      input.connectionId
    );
    const job = await prisma.$transaction(async (transaction) => {
      const erpConnection = await ensureOrganizationBlingErpConnection({
        transaction,
        organizationId: input.organizationId,
        connection
      });
      const current = await transaction.erpSyncJob.findFirst({
        where: {
          organizationId: input.organizationId,
          blingConnectionId: input.connectionId,
          type: jobTypeByOperation.IMPORT,
          status: { in: ["PENDING", "PROCESSING"] }
        },
        orderBy: { createdAt: "desc" },
        select: { id: true }
      });
      if (current) return current;

      return transaction.erpSyncJob.create({
        data: {
          organizationId: input.organizationId,
          erpConnectionId: erpConnection.id,
          blingConnectionId: input.connectionId,
          provider: ERPProvider.BLING,
          type: jobTypeByOperation.IMPORT,
          status: "PENDING",
          currentPage: 1,
          lastCursor: JSON.stringify({
            version: 2,
            operation: "IMPORT",
            automatic: true,
            preview: {
              total: 0,
              pageCounts: [],
              summary: emptyMatchSummary(),
              invalid: 0,
              reportedTotal: null,
              sourceRows: 0
            },
            progress: emptyImportProgress(),
            page: 1,
            itemIndex: 0,
            invalidRowsRecorded: false
          } satisfies BlingProductImportJobCursor)
        },
        select: { id: true }
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.getJobStatus({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      jobId: job.id,
      operation: "IMPORT"
    });
  }

  async runNextPendingJob() {
    const staleBefore = new Date(Date.now() - staleJobLeaseMs);
    await prisma.erpSyncJob.updateMany({
      where: {
        type: { in: Object.values(jobTypeByOperation) },
        status: "PROCESSING",
        updatedAt: { lt: staleBefore }
      },
      data: { status: "PENDING" }
    });
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        type: { in: Object.values(jobTypeByOperation) },
        status: "PENDING",
        blingConnectionId: { not: null }
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        organizationId: true,
        blingConnectionId: true,
        type: true
      }
    });
    if (!job?.blingConnectionId) return null;
    const operation: BlingProductJobOperation =
      job.type === jobTypeByOperation.SYNC ? "SYNC" : "IMPORT";
    try {
      return await this.runPreparedSync({
        organizationId: job.organizationId,
        connectionId: job.blingConnectionId,
        jobId: job.id,
        operation
      });
    } catch (error) {
      await prisma.erpSyncJob.updateMany({
        where: {
          id: job.id,
          organizationId: job.organizationId,
          blingConnectionId: job.blingConnectionId,
          type: job.type,
          status: "PENDING"
        },
        data: {
          status: "FAILED",
          errorMessage: "Nao foi possivel iniciar a sincronizacao."
        }
      });
      throw error;
    }
  }

  async getActiveJobStatus(input: {
    organizationId: string;
    connectionId: string;
    operation: BlingProductJobOperation;
  }) {
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: jobTypeByOperation[input.operation],
        status: { in: ["PENDING", "PROCESSING"] }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (!job) return null;
    return this.getJobStatus({ ...input, jobId: job.id });
  }

  async dryRun(input: {
    previewJobId: string;
    userId: string;
    organizationId: string;
    connectionId: string;
    operation: BlingProductJobOperation;
    correlationId: string;
    onProgress?: (progress: BlingPreviewJobProgress) => Promise<void> | void;
  }): Promise<BlingProductDryRun> {
    const startedAt = Date.now();
    let connection: Awaited<ReturnType<typeof validateBlingProductImportConnection>>;
    try {
      connection = await validateBlingProductImportConnection(input.organizationId, input.connectionId);
    } catch (error) {
      throw new BlingImportPreviewError(
        "A conexao Bling nao esta pronta para a consulta.",
        previewFailureDiagnostic({
          correlationId: input.correlationId,
          stage: "AUTHENTICATION",
          startedAt,
          error
        })
      );
    }
    if (input.operation === "SYNC") {
      return createMappedBlingSyncDryRun({
        ...input,
        connection,
        startedAt,
        onProgress: input.onProgress
      });
    }

    const fetched = await fetchAllProducts({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      correlationId: input.correlationId,
      readOnly: true,
      onProgress: input.onProgress
    });
    const uniqueProducts = new Map<string, NormalizedBlingProduct>();
    let duplicateExternalIds = 0;
    for (const product of fetched.products) {
      if (uniqueProducts.has(product.externalProductId)) duplicateExternalIds += 1;
      else uniqueProducts.set(product.externalProductId, product);
    }
    const products = [...uniqueProducts.values()];
    const listFingerprint = createHash("sha256")
      .update(JSON.stringify(products.map((product) => product.externalProductId)))
      .digest("hex");
    const integrity = evaluateBlingImportPreviewIntegrity({
      totalReportedByBling: fetched.totalReportedByBling,
      reportedTotalSource: fetched.reportedTotalSource,
      reportedTotalInvalid: fetched.reportedTotalInvalid,
      sourceRowsFetched: fetched.sourceRowsFetched,
      completedPages: fetched.completedPages,
      pageCounts: fetched.pageCounts,
      pageStatuses: fetched.pageStatuses,
      terminated: fetched.terminated,
      totalChangedDuringFetch: fetched.totalChangedDuringFetch,
      invalidRows: fetched.invalidRows,
      duplicateExternalIds,
      uniqueProductsLoaded: products.length,
      pageSize
    });
    if (!integrity.previewComplete) {
      throw new BlingImportPreviewError(
        "A previa nao passou pelas verificacoes de integridade.",
        previewFailureDiagnostic({
          correlationId: input.correlationId,
          stage: "INTEGRITY",
          startedAt,
          errorCode: integrity.reasons[0] ?? "PREVIEW_INCOMPLETE",
          expectedPages: integrity.pagesExpected,
          pageCounts: fetched.pageCounts,
          pageStatuses: fetched.pageStatuses,
          pagesCompleted: fetched.completedPages.length,
          lastDataPage: integrity.lastDataPage,
          sentinelPage: integrity.sentinelPage,
          reportedTotal: integrity.reportedTotal,
          derivedTotal: integrity.derivedTotal,
          totalSource: integrity.totalSource,
          uniqueProductsLoaded: products.length,
          duplicateCount: duplicateExternalIds,
          invalidCount: fetched.invalidRows,
          paginationComplete: integrity.paginationComplete,
          previewComplete: integrity.previewComplete,
          jobCreated: false
        })
      );
    }

    let matching: Awaited<ReturnType<typeof classifyBlingProductsForConnection>>;
    try {
      matching = await classifyBlingProductsForConnection({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        products
      });
    } catch (error) {
      throw new BlingImportPreviewError(
        "A comparacao local obrigatoria nao foi concluida.",
        previewFailureDiagnostic({
          correlationId: input.correlationId,
          stage: "LOCAL_COMPARISON",
          startedAt,
          error,
          pageCounts: fetched.pageCounts,
          pageStatuses: fetched.pageStatuses,
          pagesCompleted: fetched.completedPages.length,
          lastDataPage: integrity.lastDataPage,
          sentinelPage: integrity.sentinelPage,
          reportedTotal: integrity.reportedTotal,
          derivedTotal: integrity.derivedTotal,
          totalSource: integrity.totalSource,
          uniqueProductsLoaded: products.length,
          duplicateCount: duplicateExternalIds,
          invalidCount: fetched.invalidRows,
          paginationComplete: true,
          previewComplete: false,
          jobCreated: false
        })
      );
    }
    const syncAnalysis = { analyzed: 0, withChanges: 0, withoutChanges: 0, failures: 0 };
    const existing = matching.summary.updatedByMapping;
    const newProducts = input.operation === "IMPORT" ? matching.summary.created : 0;
    const importable = input.operation === "IMPORT"
      ? matching.summary.linkedBySku
        + matching.summary.linkedByGtin
        + matching.summary.created
      : matching.summary.updatedByMapping;
    const proof: BlingImportPreviewProof = {
      pageSize,
      firstPage: integrity.firstPage,
      lastDataPage: integrity.lastDataPage,
      sentinelPage: integrity.sentinelPage,
      pageCounts: fetched.pageCounts,
      uniqueIdsCount: products.length,
      reportedTotal: integrity.reportedTotal,
      derivedTotal: integrity.derivedTotal,
      totalSource: integrity.totalSource,
      duplicateCount: duplicateExternalIds,
      invalidCount: fetched.invalidRows,
      listFingerprint
    };
    const previewFingerprint = createBlingImportPreviewFingerprint({
      operation: input.operation,
      correlationId: input.correlationId,
      connectionId: input.connectionId,
      ...proof,
      existing,
      newProducts,
      importable,
      skuConflicts: matching.summary.skuConflicts,
      matchSummary: matching.summary
    });
    const confirmation = createBlingImportPreviewConfirmation({
      previewJobId: input.previewJobId,
      userId: input.userId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      operation: input.operation,
      correlationId: input.correlationId,
      previewFingerprint,
      proof,
      existing,
      newProducts,
      importable,
      skuConflicts: matching.summary.skuConflicts,
      matchSummary: matching.summary
    });

    return {
      operation: input.operation,
      connectionReady: true,
      connectionId: connection.id,
      connectionName: connection.name,
      correlationId: input.correlationId,
      reportedTotal: integrity.reportedTotal,
      derivedTotal: integrity.derivedTotal,
      totalSource: integrity.totalSource,
      totalReportedByBling: fetched.totalReportedByBling,
      totalFound: products.length + fetched.invalidRows,
      pagesFound: fetched.pagesFound,
      pagesCompleted: fetched.completedPages.length,
      pagesExpected: integrity.pagesExpected,
      pageSize,
      firstPage: integrity.firstPage,
      lastDataPage: integrity.lastDataPage,
      sentinelPage: integrity.sentinelPage,
      pageCounts: fetched.pageCounts,
      uniqueProductsLoaded: products.length,
      uniqueIdsCount: products.length,
      simpleProducts: products.filter((product) => !product.isVariation).length,
      variations: products.filter((product) => product.isVariation).length,
      active: products.filter((product) => product.status === "A").length,
      inactive: products.filter((product) => product.status !== "A").length,
      withoutSku: products.filter((product) => !product.sku).length,
      withoutGtin: products.filter((product) => {
        const gtin = normalizeGtin(product.gtin);
        return !gtin || !isValidGtin(gtin);
      }).length,
      existing,
      new: newProducts,
      wouldUpdate: 0,
      syncAnalyzed: syncAnalysis.analyzed,
      syncWithChanges: syncAnalysis.withChanges,
      syncWithoutChanges: syncAnalysis.withoutChanges,
      syncFailures: syncAnalysis.failures,
      importable,
      updatedByMapping: matching.summary.updatedByMapping,
      linkedBySku: input.operation === "IMPORT" ? matching.summary.linkedBySku : 0,
      linkedByGtin: input.operation === "IMPORT" ? matching.summary.linkedByGtin : 0,
      wouldCreate: input.operation === "IMPORT" ? matching.summary.created : 0,
      needsReview: input.operation === "IMPORT" ? matching.summary.needsReview : 0,
      invalid: input.operation === "IMPORT" ? fetched.invalidRows : 0,
      errors: input.operation === "IMPORT" ? fetched.errors : 0,
      ignored: input.operation === "IMPORT"
        ? matching.summary.needsReview + fetched.errors
        : 0,
      duplicateExternalIds,
      skuConflicts: matching.summary.skuConflicts,
      gtinConflicts: matching.summary.gtinConflicts,
      completed: true,
      paginationComplete: true,
      previewComplete: true,
      listFingerprint,
      previewFingerprint,
      previewExpiresAt: confirmation.previewExpiresAt,
      confirmationToken: confirmation.confirmationToken,
      warnings: [],
      durationMs: Math.max(0, Date.now() - startedAt),
      writesPerformed: false
    };
  }

  async prepareSync(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    operation?: BlingProductJobOperation;
    correlationId: string;
    previewFingerprint: string;
    confirmationToken: string;
    previewJobId: string;
  }) {
    const startedAt = Date.now();
    const confirmation = verifyBlingImportPreviewConfirmation(input.confirmationToken, input);
    const operation = input.operation ?? "IMPORT";
    try {
      const connection = await validateBlingProductImportConnection(
        input.organizationId,
        input.connectionId
      );

      const recentLease = new Date(Date.now() - staleJobLeaseMs);
      const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
      const job = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ lockState: string }>>`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
        `;
        const persistedPreview = await transaction.erpSyncJob.findFirst({
          where: {
            id: input.previewJobId,
            organizationId: input.organizationId,
            blingConnectionId: input.connectionId,
            type: previewJobTypeByOperation[operation],
            status: "COMPLETED"
          },
          select: { id: true, lastCursor: true }
        });
        const previewCursor = parseBlingProductPreviewJobCursor(
          persistedPreview?.lastCursor
        );
        if (
          !persistedPreview
          || !previewCursor?.preview
          || previewCursor.userId !== input.userId
          || previewCursor.operation !== operation
          || previewCursor.correlationId !== input.correlationId
          || previewCursor.preview.previewFingerprint !== input.previewFingerprint
          || previewCursor.preview.confirmationToken !== input.confirmationToken
          || Date.parse(previewCursor.preview.previewExpiresAt) <= Date.now()
        ) {
          return invalidPreviewConfirmation(input.correlationId, "PREVIEW_STALE");
        }
        const erpConnection =
          await ensureOrganizationBlingErpConnection({
            transaction,
            organizationId: input.organizationId,
            connection
          });
        const existingJob = await transaction.erpSyncJob.findFirst({
          where: {
            organizationId: input.organizationId,
            blingConnectionId: input.connectionId,
            type: { in: Object.values(jobTypeByOperation) },
            OR: [
              { status: "PENDING", createdAt: { gte: recentLease } },
              { status: "PROCESSING", updatedAt: { gte: recentLease } }
            ]
          },
          select: { id: true }
        });
        if (existingJob) throw new Error("Ja existe uma sincronizacao de produtos em andamento para esta conta.");

        const preparedJob = await transaction.erpSyncJob.create({
          data: {
            organizationId: input.organizationId,
            erpConnectionId: erpConnection.id,
            blingConnectionId: input.connectionId,
            provider: ERPProvider.BLING,
            type: jobTypeByOperation[operation],
            status: "PENDING",
            currentPage: 1,
            lastCursor: JSON.stringify({
              version: 2,
              operation,
              automatic: false,
              preview: {
                total: operation === "IMPORT"
                  ? confirmation.uniqueIdsCount + confirmation.invalidCount
                  : confirmation.matchSummary.updatedByMapping,
                pageCounts: confirmation.pageCounts,
                summary: confirmation.matchSummary,
                invalid: confirmation.invalidCount,
                reportedTotal: confirmation.reportedTotal,
                sourceRows: 0,
                listFingerprint: confirmation.listFingerprint
              },
              progress: emptyImportProgress(),
              page: 1,
              itemIndex: 0,
              invalidRowsRecorded: false,
              ...(operation === "SYNC"
                ? { syncReport: emptyBlingProductSyncReport() }
                : {})
            } satisfies BlingProductImportJobCursor)
          },
          select: {
            id: true,
            status: true,
            currentPage: true,
            lastCursor: true
          }
        });
        const consumed = await transaction.erpSyncJob.updateMany({
          where: {
            id: persistedPreview.id,
            organizationId: input.organizationId,
            blingConnectionId: input.connectionId,
            type: previewJobTypeByOperation[operation],
            status: "COMPLETED"
          },
          data: { status: "CONSUMED" }
        });
        if (consumed.count !== 1) {
          return invalidPreviewConfirmation(input.correlationId, "PREVIEW_STALE");
        }
        return preparedJob;
      });
      return this.getJobStatus({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        jobId: job.id
      });
    } catch (error) {
      if (error instanceof BlingImportPreviewError) throw error;
      const errorCode =
        error instanceof BlingErpConnectionCompatibilityError
          ? error.code
          : error instanceof BlingApiError
            ? error.code
            : error instanceof Error && error.message.includes("em andamento")
              ? "JOB_ALREADY_RUNNING"
              : "PREPARE_SYNC_FAILED";
      throw new BlingImportPreviewError(
        "Nao foi possivel preparar a sincronizacao.",
        previewFailureDiagnostic({
          correlationId: input.correlationId,
          stage: "PREPARE_SYNC",
          startedAt,
          error,
          errorCode,
          previewComplete: false,
          jobCreated: false
        })
      );
    }
  }

  async reconcileProductStatuses(input: {
    organizationId: string;
    connectionId: string;
    confirm: boolean;
  }): Promise<BlingProductStatusBackfillReport> {
    await validateBlingProductImportConnection(input.organizationId, input.connectionId);
    const fetched = await fetchAllProducts({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      readOnly: true,
      criterion: 5
    });
    return reconcileLinkedStatusSnapshot({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      products: fetched.products,
      confirm: input.confirm,
      fetched
    });
  }

  async runPreparedSync(input: {
    organizationId: string;
    connectionId: string;
    jobId: string;
    operation?: BlingProductJobOperation;
  }) {
    const staleBefore = new Date(Date.now() - staleJobLeaseMs);
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: input.operation ? jobTypeByOperation[input.operation] : { in: Object.values(jobTypeByOperation) },
        status: "PENDING"
      }
    });
    if (!job) throw new Error("Sincronizacao nao encontrada, ja concluida ou em andamento.");
    await validateBlingProductImportConnection(
      input.organizationId,
      input.connectionId,
      { allowOfficialRefresh: true }
    );
    const initialCursor = parseBlingProductImportJobCursor(job.lastCursor);
    if (!initialCursor) throw new Error("O plano da sincronizacao nao esta integro.");
    if (input.operation && initialCursor.operation !== input.operation) {
      throw new Error("A operacao do job nao corresponde ao modo solicitado.");
    }

    const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
    const claimed = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ lockState: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
      `;
      const competingJob = await transaction.erpSyncJob.findFirst({
        where: {
          id: { not: job.id },
          organizationId: input.organizationId,
          blingConnectionId: input.connectionId,
          type: jobTypeByOperation[initialCursor.operation],
          status: "PROCESSING",
          updatedAt: { gte: staleBefore }
        },
        select: { id: true }
      });
      if (competingJob) throw new Error("Ja existe uma sincronizacao de produtos em andamento para esta conta.");
      return transaction.erpSyncJob.updateMany({
        where: {
          id: job.id,
          organizationId: input.organizationId,
          blingConnectionId: input.connectionId,
          type: jobTypeByOperation[initialCursor.operation],
          status: "PENDING"
        },
        data: { status: "PROCESSING", startedAt: job.startedAt ?? new Date(), errorMessage: null }
      });
    });
    if (claimed.count !== 1) throw new Error("Esta sincronizacao ja esta em andamento.");

    const page = Math.max(1, job.currentPage);
    try {
      const expectedPageCount = initialCursor.preview.pageCounts[page - 1];
      if (expectedPageCount === undefined && !initialCursor.automatic) {
        throw new Error("A pagina solicitada nao pertence a previa confirmada.");
      }
      let normalized: ReturnType<typeof normalizePage>;
      let matching: Awaited<ReturnType<typeof classifyBlingProductsForConnection>>;
      if (initialCursor.operation === "SYNC") {
        const mapped = await loadMappedBlingProductsForSync(
          input.organizationId,
          input.connectionId
        );
        const listFingerprint = createHash("sha256")
          .update(JSON.stringify(mapped.map((row) => row.externalProductId)))
          .digest("hex");
        if (
          !initialCursor.preview.listFingerprint
          || listFingerprint !== initialCursor.preview.listFingerprint
        ) {
          throw new Error("A lista de produtos vinculados mudou depois da previa.");
        }
        const pageRows = mapped.slice((page - 1) * pageSize, page * pageSize);
        normalized = {
          products: pageRows.map((row) => row.product),
          sourceRowCount: pageRows.length,
          invalidRows: 0,
          totalReported: null,
          totalSource: "NONE",
          totalInvalid: false,
          httpStatus: 200
        };
        const matches = new Map<string, BlingProductImportMatch>(
          pageRows.map((row) => [
            row.externalProductId,
            { kind: "MAPPING", productId: row.productId, conflictField: null }
          ])
        );
        matching = {
          mappings: new Map(pageRows.map((row) => [row.externalProductId, row.productId])),
          matches,
          summary: { ...emptyMatchSummary(), updatedByMapping: pageRows.length }
        };
      } else {
        const payload = await fetchCatalogPage({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          page,
          readOnly: false
        });
        normalized = normalizePage(payload);
        matching = await classifyBlingProductsForConnection({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          products: normalized.products
        });
      }
      if (
        expectedPageCount !== undefined
        && normalized.sourceRowCount !== expectedPageCount
      ) {
        throw new Error("A pagina atual diverge da previa confirmada.");
      }
      if (
        initialCursor.automatic
        && initialCursor.preview.reportedTotal !== null
        && normalized.totalReported !== null
        && normalized.totalReported !== initialCursor.preview.reportedTotal
      ) {
        throw new Error("O total do catalogo mudou durante a importacao inicial.");
      }
      const pageAlreadyStarted =
        initialCursor.itemIndex > 0 || initialCursor.invalidRowsRecorded;
      const pageCounts = initialCursor.automatic && !pageAlreadyStarted
        ? [...initialCursor.preview.pageCounts, normalized.sourceRowCount]
        : initialCursor.preview.pageCounts;
      const sourceRows =
        initialCursor.preview.sourceRows
        + (initialCursor.automatic && !pageAlreadyStarted
          ? normalized.sourceRowCount
          : 0);
      const reportedTotal =
        initialCursor.preview.reportedTotal ?? normalized.totalReported;
      const pageCursor: BlingProductImportJobCursor = {
        ...initialCursor,
        preview: {
          ...initialCursor.preview,
          total: initialCursor.automatic
            ? reportedTotal ?? sourceRows
            : initialCursor.preview.total,
          pageCounts,
          summary: initialCursor.automatic && !pageAlreadyStarted
            ? addMatchSummaries(initialCursor.preview.summary, matching.summary)
            : initialCursor.preview.summary,
          invalid: initialCursor.preview.invalid + (
            initialCursor.automatic && !pageAlreadyStarted
              ? normalized.invalidRows
              : 0
          ),
          reportedTotal,
          sourceRows
        }
      };
      const cursor = await applyPage({
        operation: initialCursor.operation,
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        erpConnectionId: job.erpConnectionId,
        jobId: job.id,
        page,
        products: normalized.products,
        matches: matching.matches,
        invalidRows: initialCursor.operation === "IMPORT"
          ? normalized.invalidRows
          : 0,
        cursor: pageCursor
      });
      const completed = initialCursor.automatic
        ? normalized.sourceRowCount < pageSize
          || (reportedTotal !== null && sourceRows >= reportedTotal)
        : page >= initialCursor.preview.pageCounts.length;
      const nextCursor = {
        ...cursor,
        page: page + 1,
        itemIndex: 0,
        invalidRowsRecorded: false
      };

      await prisma.$transaction(async (transaction) => {
        await transaction.erpSyncJob.update({
          where: { id: job.id },
          data: {
            status: completed ? "COMPLETED" : "PENDING",
            currentPage: page + 1,
            finishedAt: completed ? new Date() : null,
            errorMessage: null,
            lastCursor: JSON.stringify(nextCursor)
          }
        });
        if (completed) {
          await transaction.blingConnection.updateMany({
            where: { id: input.connectionId, organizationId: input.organizationId },
            data: { lastProductSyncAt: new Date() }
          });
          if (initialCursor.operation === "SYNC") {
            await ensureBlingSyncCompletionNotification(transaction, {
              organizationId: input.organizationId,
              jobId: job.id
            });
          }
        }
      });
      return this.getJobStatus(input);
    } catch (error) {
      await prisma.erpSyncJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorMessage: isTemporary(error) ? "Falha temporaria. A sincronizacao pode ser retomada." : "Nao foi possivel concluir a sincronizacao." }
      });
      throw error;
    }
  }

  async getJobStatus(input: {
    organizationId: string;
    connectionId: string;
    jobId: string;
    operation?: BlingProductJobOperation;
  }) {
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: input.operation
          ? jobTypeByOperation[input.operation]
          : { in: Object.values(jobTypeByOperation) }
      },
      select: {
        id: true,
        type: true,
        status: true,
        totalFetched: true,
        totalCreatedDrafts: true,
        totalUpdatedDrafts: true,
        totalExistingProducts: true,
        totalErrors: true,
        currentPage: true,
        startedAt: true,
        finishedAt: true,
        errorMessage: true,
        lastCursor: true
      }
    });
    if (!job) throw new Error("Sincronizacao nao encontrada.");
    const cursor = parseBlingProductImportJobCursor(job.lastCursor);
    return {
      ...job,
      operation: cursor?.operation ?? (
        job.type === jobTypeByOperation.SYNC ? "SYNC" : "IMPORT"
      ),
      errorCode: job.status === "FAILED" ? "WORKER_FAILED" : null,
      previewTotal: cursor?.preview.total ?? 0,
      updatedByMapping: cursor?.preview.summary.updatedByMapping ?? 0,
      plannedLinkedBySku: cursor?.preview.summary.linkedBySku ?? 0,
      plannedLinkedByGtin: cursor?.preview.summary.linkedByGtin ?? 0,
      plannedCreated: cursor?.preview.summary.created ?? 0,
      plannedNeedsReview: cursor?.preview.summary.needsReview ?? 0,
      processed: cursor?.progress.processed ?? job.totalFetched,
      created: cursor?.progress.created ?? job.totalCreatedDrafts,
      updated: cursor?.progress.updated ?? job.totalUpdatedDrafts,
      linkedBySku: cursor?.progress.linkedBySku ?? 0,
      linkedByGtin: cursor?.progress.linkedByGtin ?? 0,
      noChanges: cursor?.progress.noChanges ?? 0,
      needsReview: cursor?.progress.needsReview ?? 0,
      invalid: cursor?.progress.invalid ?? 0,
      failed: cursor?.progress.failed ?? job.totalErrors,
      syncReport: cursor?.syncReport ?? null
    };
  }
}

export const blingProductImportService = new BlingProductImportService();
