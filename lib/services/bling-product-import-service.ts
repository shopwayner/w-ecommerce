import { createHash } from "node:crypto";
import { ERPProvider, Prisma } from "@prisma/client";
import {
  BlingImportPreviewError,
  collectBlingPreviewPages,
  evaluateBlingImportPreviewIntegrity,
  validateBlingImportPreviewProof,
  type BlingImportTotalSource,
  type BlingImportPreviewFailureDiagnostic
} from "@/lib/bling-product-import-preview";
import { prisma } from "@/lib/prisma";
import {
  extractBlingProductBrand,
  normalizeProductBrand,
  resolveProductBrandFromBling
} from "@/lib/product-brand";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";
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

type JsonRecord = Record<string, unknown>;

type BlingCatalogResponse = {
  data?: unknown;
  meta?: unknown;
  pagination?: unknown;
  total?: unknown;
};

export type NormalizedBlingProduct = {
  externalProductId: string;
  parentExternalProductId: string | null;
  name: string;
  sku: string | null;
  gtin: string | null;
  packagingGtin: string | null;
  description: string | null;
  price: number | null;
  costPrice: number | null;
  stock: number | null;
  unit: string | null;
  imageUrl: string | null;
  brand: string | null;
  category: string | null;
  ncm: string | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
  status: string;
  format: string;
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
  version: 1;
  preview: {
    total: number;
    pageCounts: number[];
    summary: BlingProductImportMatchSummary;
    invalid: number;
  };
  progress: BlingProductImportProgress;
  page: number;
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
  version: 3;
  operation: "BLING_PRODUCT_IMPORT_PREVIEW";
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

export function readCanonicalBlingStatusFromAttributes(attributes: unknown): CanonicalBlingProductStatus {
  const bling = record(record(attributes).bling);
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
  const format = firstText(raw.formato, raw.tipo, parent?.format) ?? "UNKNOWN";

  return {
    externalProductId,
    parentExternalProductId: parent?.externalProductId ?? null,
    name,
    sku: firstText(raw.codigo, raw.sku),
    gtin: firstText(raw.gtin, raw.ean),
    packagingGtin: firstText(raw.gtinEmbalagem, raw.eanEmbalagem, parent?.packagingGtin),
    description: firstText(raw.descricaoComplementar, raw.descricaoCurta, parent?.description),
    price: positiveOrNull(raw.preco),
    costPrice: firstNumber(raw.precoCusto, supplier.precoCusto),
    stock: integer(stock.saldoVirtualTotal ?? stock.saldoFisicoTotal ?? stock.saldo ?? raw.estoqueAtual),
    unit: firstText(raw.unidade, parent?.unit),
    imageUrl: firstText(media.imagemURL, media.imagemUrl, raw.imagemURL, raw.imagemUrl, parent?.imageUrl),
    brand: extractBlingProductBrand(raw) ?? parent?.brand ?? null,
    category: firstText(category.descricao, category.nome, raw.categoriaNome, parent?.category),
    ncm: firstText(record(raw.tributacao).ncm, raw.ncm, parent?.ncm),
    weight: firstNumber(raw.pesoLiquido, raw.pesoBruto, dimensions.peso, parent?.weight),
    height: firstNumber(dimensions.altura, raw.altura, parent?.height),
    width: firstNumber(dimensions.largura, raw.largura, parent?.width),
    depth: firstNumber(dimensions.profundidade, raw.profundidade, raw.comprimento, parent?.depth),
    status: firstText(raw.situacao, parent?.status) ?? "UNKNOWN",
    format,
    isVariation: Boolean(parent)
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
    price: preferDetailValue(detail.price, summary.price),
    costPrice: preferDetailValue(detail.costPrice, summary.costPrice),
    stock: preferDetailValue(detail.stock, summary.stock),
    unit: preferDetailValue(detail.unit, summary.unit),
    imageUrl: preferDetailValue(detail.imageUrl, summary.imageUrl),
    brand: preferDetailValue(detail.brand, summary.brand),
    category: preferDetailValue(detail.category, summary.category),
    ncm: preferDetailValue(detail.ncm, summary.ncm),
    weight: preferDetailValue(detail.weight, summary.weight),
    height: preferDetailValue(detail.height, summary.height),
    width: preferDetailValue(detail.width, summary.width),
    depth: preferDetailValue(detail.depth, summary.depth),
    status: detail.status === "UNKNOWN" ? summary.status : detail.status,
    format: detail.format === "UNKNOWN" ? summary.format : detail.format,
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

async function validateConnection(organizationId: string, connectionId: string) {
  const connection = await prisma.blingConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: {
      id: true,
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
    || connection.tokens[0].expiresAt.getTime() <= Date.now()
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
    classifyFailure: classifyPreviewFailure
  });

  return {
    ...collected,
    errors: collected.invalidRows,
    completed: collected.terminated
  };
}

function safeProductAttributes(
  current: Prisma.JsonValue | null,
  product: NormalizedBlingProduct,
  connectionId: string,
  statusCheckedAt = new Date().toISOString()
) {
  const existing = record(current);
  const normalizedStatus = normalizeBlingProductStatus(product.status);
  return {
    ...existing,
    bling: {
      ...record(existing.bling),
      externalProductId: product.externalProductId,
      parentExternalProductId: product.parentExternalProductId,
      sku: product.sku,
      connectionId,
      status: normalizedStatus.status,
      externalStatus: normalizedStatus.externalStatus,
      statusCheckedAt,
      format: product.format,
      source: "CATALOG_READ"
    }
  } as Prisma.InputJsonValue;
}

export function mergeBlingProductStatusAttributes(
  current: Prisma.JsonValue | null,
  status: CanonicalBlingProductStatus,
  externalStatus: "A" | "I" | "E" | null,
  statusCheckedAt: string
) {
  const existing = record(current);
  return {
    ...existing,
    bling: {
      ...record(existing.bling),
      status,
      externalStatus,
      statusCheckedAt
    }
  } as Prisma.InputJsonValue;
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
        input.statusCheckedAt
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
  expected: NormalizedBlingProductStatus
) {
  const bling = record(record(attributes).bling);
  return (
    readCanonicalBlingStatusFromAttributes(attributes) === expected.status &&
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
    if (productStatusMetadataMatches(mapping.product.attributes, status)) return [];
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
      packagingGtin: product.packagingGtin
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

function sameNullableNumber(left: Prisma.Decimal | number | null, right: number | null) {
  if (left === null || right === null) return left === null && right === null;
  return Number(left) === right;
}

function blingAttributeIdentity(value: Prisma.JsonValue | Prisma.InputJsonValue | null) {
  const bling = record(record(value).bling);
  return {
    externalProductId: text(bling.externalProductId) || null,
    parentExternalProductId: text(bling.parentExternalProductId) || null,
    sku: text(bling.sku) || null,
    connectionId: text(bling.connectionId) || null,
    status: text(bling.status) || null,
    externalStatus: text(bling.externalStatus) || null,
    format: text(bling.format) || null,
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
}) {
  const amount = input.amount ?? 1;
  const progress = nextProgress(input.cursor.progress, input.status, amount);
  const cursor = { ...input.cursor, progress };
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

async function updateMatchedProduct(
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
      height: true,
      width: true,
      depth: true,
      source: true,
      attributes: true
    }
  });
  if (!current) throw new Error("O produto vinculado nao pertence a organizacao atual.");

  let nextSku = current.sku;
  const remoteSku = input.product.sku?.trim() || null;
  if (remoteSku && remoteSku !== current.sku) {
    const conflict = await transaction.product.findFirst({
      where: {
        organizationId: input.organizationId,
        sku: remoteSku,
        id: { not: current.id }
      },
      select: { id: true }
    });
    if (!conflict) nextSku = remoteSku;
  }
  const nextEan = resolveImportedGtin(input.product.gtin, current.ean);
  const nextPackagingGtin = resolveImportedGtin(
    input.product.packagingGtin,
    current.packagingGtin
  );
  const nextBrand = resolveProductBrandFromBling(current.brand, input.product.brand);
  const update: Prisma.ProductUncheckedUpdateInput = {};
  if (nextSku !== current.sku) update.sku = nextSku;
  if (nextEan !== current.ean) update.ean = nextEan;
  if (nextPackagingGtin !== current.packagingGtin) {
    update.packagingGtin = nextPackagingGtin;
  }
  if (input.product.name !== current.name) update.name = input.product.name;
  if (input.product.description !== current.description) update.description = input.product.description;
  if (input.product.category !== current.category) update.category = input.product.category;
  if (nextBrand !== current.brand) update.brand = nextBrand;
  if (input.product.ncm !== current.ncm) update.ncm = input.product.ncm;
  if (!sameNullableNumber(current.weight, input.product.weight)) update.weight = input.product.weight;
  if (!sameNullableNumber(current.height, input.product.height)) update.height = input.product.height;
  if (!sameNullableNumber(current.width, input.product.width)) update.width = input.product.width;
  if (!sameNullableNumber(current.depth, input.product.depth)) update.depth = input.product.depth;
  if (current.source !== "BLING") update.source = "BLING";

  const nextAttributes = safeProductAttributes(current.attributes, input.product, input.connectionId);
  if (
    JSON.stringify(blingAttributeIdentity(current.attributes))
    !== JSON.stringify(blingAttributeIdentity(nextAttributes))
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
  return productChanged || priceChanged || inventoryChanged;
}

async function applyProduct(input: {
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  page: number;
  product: NormalizedBlingProduct;
  preliminaryMatch: BlingProductImportMatch;
  cursor: BlingProductImportJobCursor;
}) {
  const product = input.preliminaryMatch.kind === "CREATE"
    ? await hydrateNewBlingProductFromDetail({
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
    if (resolved.match.kind === "NEEDS_REVIEW") {
      await upsertImportDraft(
        transaction,
        product,
        input.organizationId,
        input.erpConnectionId,
        input.connectionId,
        "NEEDS_REVIEW"
      );
      const cursor = await persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor: input.cursor,
        status: "NEEDS_REVIEW"
      });
      return { status: "NEEDS_REVIEW" as const, cursor };
    }

    if (resolved.match.kind === "CREATE") {
      const ean = resolveImportedGtin(product.gtin);
      const packagingGtin = resolveImportedGtin(product.packagingGtin);
      const createdProduct = await transaction.product.create({
        data: {
          organizationId: input.organizationId,
          sku: product.sku?.trim() || null,
          ean,
          packagingGtin,
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
          height: product.height,
          width: product.width,
          depth: product.depth,
          attributes: safeProductAttributes(null, product, input.connectionId)
        },
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
    const changed = await updateMatchedProduct(transaction, {
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      productId: resolved.match.productId,
      product
    });

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
    await upsertImportDraft(
      transaction,
      product,
      input.organizationId,
      input.erpConnectionId,
      input.connectionId,
      status
    );
    const cursor = await persistItemProgress({
      transaction,
      jobId: input.jobId,
      cursor: input.cursor,
      status
    });
    return { status, cursor };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function recordFailedProduct(input: {
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  product: NormalizedBlingProduct;
  cursor: BlingProductImportJobCursor;
}) {
  return prisma.$transaction(async (transaction) => {
    await upsertImportDraft(
      transaction,
      input.product,
      input.organizationId,
      input.erpConnectionId,
      input.connectionId,
      "FAILED"
    );
    return persistItemProgress({
      transaction,
      jobId: input.jobId,
      cursor: input.cursor,
      status: "FAILED"
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function applyPage(input: {
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
    items: input.products,
    initialState: input.cursor,
    processItem: async (product, currentCursor) => {
      const preliminaryMatch = input.matches.get(product.externalProductId);
      if (!preliminaryMatch) {
        throw new Error("A classificacao preliminar do produto nao foi encontrada.");
      }
      const result = await applyProduct({
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
    recordFailure: (product, currentCursor) =>
      recordFailedProduct({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        erpConnectionId: input.erpConnectionId,
        jobId: input.jobId,
        product,
        cursor: currentCursor
      })
  });

  if (input.invalidRows > 0) {
    cursor = await prisma.$transaction((transaction) =>
      persistItemProgress({
        transaction,
        jobId: input.jobId,
        cursor,
        status: "INVALID",
        amount: input.invalidRows
      })
    );
  }
  return cursor;
}

function parseBlingProductImportJobCursor(value: string | null): BlingProductImportJobCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as BlingProductImportJobCursor;
    if (
      parsed.version !== 1
      || !Array.isArray(parsed.preview?.pageCounts)
      || !parsed.preview.pageCounts.every(validNonNegativeInteger)
      || !validNonNegativeInteger(parsed.preview.total)
      || !parsed.preview.summary
      || !Object.values(parsed.preview.summary).every(validNonNegativeInteger)
      || !parsed.progress
      || !Object.values(parsed.progress).every(validNonNegativeInteger)
      || !validNonNegativeInteger(parsed.page)
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
  correlationId: string;
  connectionId: string;
  existing: number;
  newProducts: number;
  importable: number;
  skuConflicts: number;
  matchSummary: BlingProductImportMatchSummary;
};

const latestPreviewCorrelations = new Map<string, string>();

function previewCorrelationKey(input: {
  userId: string;
  organizationId: string;
  connectionId: string;
}) {
  return `${input.userId}:${input.organizationId}:${input.connectionId}`;
}

export function registerBlingImportPreviewCorrelation(input: {
  userId: string;
  organizationId: string;
  connectionId: string;
  correlationId: string;
}) {
  latestPreviewCorrelations.set(previewCorrelationKey(input), input.correlationId);
}

export function resetBlingImportPreviewCorrelationsForTests() {
  latestPreviewCorrelations.clear();
}

function invalidateBlingImportPreviewCorrelation(input: {
  userId: string;
  organizationId: string;
  connectionId: string;
  correlationId: string;
}) {
  const key = previewCorrelationKey(input);
  if (latestPreviewCorrelations.get(key) === input.correlationId) {
    latestPreviewCorrelations.delete(key);
  }
}

export function createBlingImportPreviewFingerprint(
  input: BlingImportPreviewFingerprintInput
) {
  return createHash("sha256").update(JSON.stringify({
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
    userId: string;
    organizationId: string;
    connectionId: string;
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
  registerBlingImportPreviewCorrelation(input);
  const confirmation: BlingImportPreviewConfirmation = {
    version: 3,
    operation: "BLING_PRODUCT_IMPORT_PREVIEW",
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

function invalidPreviewConfirmation(correlationId: string): never {
  throw new BlingImportPreviewError(
    "A previa expirou ou nao corresponde a esta execucao.",
    {
      correlationId,
      stage: "PREPARE_SYNC",
      page: null,
      expectedPages: null,
      httpStatus: 409,
      errorCode: "PREVIEW_INVALID_OR_EXPIRED",
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
    userId: string;
    organizationId: string;
    connectionId: string;
    correlationId: string;
    previewFingerprint: string;
  },
  now = new Date()
) {
  try {
    const confirmation = JSON.parse(decryptSecret(encrypted)) as BlingImportPreviewConfirmation;
    const issuedAt = Date.parse(confirmation.issuedAt);
    const expiresAt = Date.parse(confirmation.expiresAt);
    const latestCorrelation = latestPreviewCorrelations.get(previewCorrelationKey(input));
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
      && confirmation.newProducts === confirmation.matchSummary.created
      && confirmation.importable ===
        confirmation.matchSummary.updatedByMapping
        + confirmation.matchSummary.linkedBySku
        + confirmation.matchSummary.linkedByGtin
        + confirmation.matchSummary.created
      && confirmation.skuConflicts === confirmation.matchSummary.skuConflicts
      && confirmation.matchSummary.skuConflicts
        + confirmation.matchSummary.gtinConflicts === confirmation.matchSummary.needsReview;
    const recalculatedFingerprint = createBlingImportPreviewFingerprint({
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
    if (
      confirmation.version !== 3
      || confirmation.operation !== "BLING_PRODUCT_IMPORT_PREVIEW"
      || confirmation.userId !== input.userId
      || confirmation.organizationId !== input.organizationId
      || confirmation.connectionId !== input.connectionId
      || confirmation.correlationId !== input.correlationId
      || confirmation.previewFingerprint !== input.previewFingerprint
      || recalculatedFingerprint !== input.previewFingerprint
      || latestCorrelation !== input.correlationId
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
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || expiresAt <= now.getTime()
      || expiresAt - issuedAt !== previewConfirmationLifetimeMs
    ) {
      throw new Error("invalid");
    }
    return confirmation;
  } catch {
    return invalidPreviewConfirmation(input.correlationId);
  }
}

export function consumeBlingImportPreviewConfirmation(
  encrypted: string,
  input: Parameters<typeof verifyBlingImportPreviewConfirmation>[1],
  now = new Date()
) {
  const confirmation = verifyBlingImportPreviewConfirmation(encrypted, input, now);
  invalidateBlingImportPreviewCorrelation(input);
  return confirmation;
}

export class BlingProductImportService {
  async dryRun(input: {
    userId: string;
    organizationId: string;
    connectionId: string;
    correlationId: string;
  }): Promise<BlingProductDryRun> {
    const startedAt = Date.now();
    registerBlingImportPreviewCorrelation(input);
    let connection: Awaited<ReturnType<typeof validateConnection>>;
    try {
      connection = await validateConnection(input.organizationId, input.connectionId);
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

    const fetched = await fetchAllProducts({
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      correlationId: input.correlationId,
      readOnly: true
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
    const existing = matching.summary.updatedByMapping;
    const newProducts = matching.summary.created;
    const importable =
      matching.summary.updatedByMapping
      + matching.summary.linkedBySku
      + matching.summary.linkedByGtin
      + matching.summary.created;
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
      userId: input.userId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
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
      wouldUpdate:
        matching.summary.updatedByMapping
        + matching.summary.linkedBySku
        + matching.summary.linkedByGtin,
      importable,
      updatedByMapping: matching.summary.updatedByMapping,
      linkedBySku: matching.summary.linkedBySku,
      linkedByGtin: matching.summary.linkedByGtin,
      wouldCreate: matching.summary.created,
      needsReview: matching.summary.needsReview,
      invalid: fetched.invalidRows,
      errors: fetched.errors,
      ignored: matching.summary.needsReview + fetched.errors,
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
    correlationId: string;
    previewFingerprint: string;
    confirmationToken: string;
  }) {
    const startedAt = Date.now();
    const confirmation = consumeBlingImportPreviewConfirmation(input.confirmationToken, input);
    try {
      await validateConnection(input.organizationId, input.connectionId);
      const erpConnection = await prisma.eRPConnection.findUnique({
        where: { organizationId_provider: { organizationId: input.organizationId, provider: ERPProvider.BLING } },
        select: { id: true }
      });
      if (!erpConnection) throw new Error("A integracao Bling precisa ser configurada antes da sincronizacao.");

      const recentLease = new Date(Date.now() - staleJobLeaseMs);
      const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
      const job = await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ lockState: string }>>`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lockState"
        `;
        const existingJob = await transaction.erpSyncJob.findFirst({
          where: {
            organizationId: input.organizationId,
            blingConnectionId: input.connectionId,
            type: "PRODUCTS_FULL_SYNC",
            OR: [
              { status: "PENDING", createdAt: { gte: recentLease } },
              { status: "PROCESSING", updatedAt: { gte: recentLease } }
            ]
          },
          select: { id: true }
        });
        if (existingJob) throw new Error("Ja existe uma sincronizacao de produtos em andamento para esta conta.");

        return transaction.erpSyncJob.create({
          data: {
            organizationId: input.organizationId,
            erpConnectionId: erpConnection.id,
            blingConnectionId: input.connectionId,
            provider: ERPProvider.BLING,
            type: "PRODUCTS_FULL_SYNC",
            status: "PENDING",
            currentPage: 1,
            lastCursor: JSON.stringify({
              version: 1,
              preview: {
                total: confirmation.uniqueIdsCount + confirmation.invalidCount,
                pageCounts: confirmation.pageCounts,
                summary: confirmation.matchSummary,
                invalid: confirmation.invalidCount
              },
              progress: emptyImportProgress(),
              page: 1
            } satisfies BlingProductImportJobCursor)
          },
          select: {
            id: true,
            status: true,
            currentPage: true,
            lastCursor: true
          }
        });
      });
      return this.getJobStatus({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        jobId: job.id
      });
    } catch (error) {
      if (error instanceof BlingImportPreviewError) throw error;
      throw new BlingImportPreviewError(
        "Nao foi possivel preparar a sincronizacao.",
        previewFailureDiagnostic({
          correlationId: input.correlationId,
          stage: "PREPARE_SYNC",
          startedAt,
          error,
          errorCode: "PREPARE_SYNC_FAILED",
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
    await validateConnection(input.organizationId, input.connectionId);
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

  async runPreparedSync(input: { organizationId: string; connectionId: string; jobId: string }) {
    const staleBefore = new Date(Date.now() - staleJobLeaseMs);
    const job = await prisma.erpSyncJob.findFirst({
      where: {
        id: input.jobId,
        organizationId: input.organizationId,
        blingConnectionId: input.connectionId,
        type: "PRODUCTS_FULL_SYNC",
        status: "PENDING"
      }
    });
    if (!job) throw new Error("Sincronizacao nao encontrada, ja concluida ou em andamento.");
    await validateConnection(input.organizationId, input.connectionId);
    const initialCursor = parseBlingProductImportJobCursor(job.lastCursor);
    if (!initialCursor) throw new Error("O plano da sincronizacao nao esta integro.");

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
          type: "PRODUCTS_FULL_SYNC",
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
          type: "PRODUCTS_FULL_SYNC",
          status: "PENDING"
        },
        data: { status: "PROCESSING", startedAt: job.startedAt ?? new Date(), errorMessage: null }
      });
    });
    if (claimed.count !== 1) throw new Error("Esta sincronizacao ja esta em andamento.");

    const page = Math.max(1, job.currentPage);
    try {
      const expectedPageCount = initialCursor.preview.pageCounts[page - 1];
      if (expectedPageCount === undefined) {
        throw new Error("A pagina solicitada nao pertence a previa confirmada.");
      }
      const payload = await fetchCatalogPage({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        page,
        readOnly: false
      });
      const normalized = normalizePage(payload);
      if (normalized.sourceRowCount !== expectedPageCount) {
        throw new Error("A pagina atual diverge da previa confirmada.");
      }
      const matching = await classifyBlingProductsForConnection({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        products: normalized.products
      });
      const cursor = await applyPage({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        erpConnectionId: job.erpConnectionId,
        jobId: job.id,
        page,
        products: normalized.products,
        matches: matching.matches,
        invalidRows: normalized.invalidRows,
        cursor: initialCursor
      });
      const completed = page >= initialCursor.preview.pageCounts.length;
      const nextCursor = { ...cursor, page: page + 1 };

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

  async getJobStatus(input: { organizationId: string; connectionId: string; jobId: string }) {
    const job = await prisma.erpSyncJob.findFirst({
      where: { id: input.jobId, organizationId: input.organizationId, blingConnectionId: input.connectionId, type: "PRODUCTS_FULL_SYNC" },
      select: {
        id: true,
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
      failed: cursor?.progress.failed ?? job.totalErrors
    };
  }
}

export const blingProductImportService = new BlingProductImportService();
