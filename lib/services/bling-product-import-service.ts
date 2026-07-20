import { ERPProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  extractBlingProductBrand,
  normalizeProductBrand,
  resolveProductBrandFromBling
} from "@/lib/product-brand";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";

const pageSize = 100;
const maxSafetyPages = 1_000;
const maxRetryAttempts = 3;
const staleJobLeaseMs = 5 * 60 * 1_000;

type JsonRecord = Record<string, unknown>;

type BlingCatalogResponse = {
  data?: unknown;
  meta?: unknown;
  pagination?: unknown;
  total?: unknown;
};

type NormalizedBlingProduct = {
  externalProductId: string;
  parentExternalProductId: string | null;
  name: string;
  sku: string | null;
  gtin: string | null;
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
  totalReportedByBling: number | null;
  totalFound: number;
  pagesFound: number;
  simpleProducts: number;
  variations: number;
  active: number;
  inactive: number;
  withoutSku: number;
  existing: number;
  new: number;
  wouldUpdate: number;
  importable: number;
  errors: number;
  ignored: number;
  duplicateExternalIds: number;
  skuConflicts: number;
  completed: boolean;
  writesPerformed: false;
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
  return firstNumber(payload.total, meta.total, meta.totalRegistros, metaPagination.total, pagination.total);
}

function normalizeOne(rawValue: unknown, parent?: NormalizedBlingProduct): NormalizedBlingProduct | null {
  const raw = record(rawValue);
  const externalProductId = firstText(raw.id, raw.idProduto, raw.externalId);
  if (!externalProductId) return null;

  const stock = record(raw.estoque);
  const dimensions = record(raw.dimensoes);
  const media = record(raw.midia);
  const category = record(raw.categoria);
  const supplier = record(raw.fornecedor);
  const format = firstText(raw.formato, raw.tipo, parent?.format) ?? "UNKNOWN";

  return {
    externalProductId,
    parentExternalProductId: parent?.externalProductId ?? null,
    name: firstText(raw.nome, raw.descricao, parent?.name) ?? "Produto Bling",
    sku: firstText(raw.codigo, raw.sku),
    gtin: firstText(raw.gtin, raw.ean),
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

function normalizePage(payload: BlingCatalogResponse) {
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

  return { products, sourceRowCount: rows.length, invalidRows, totalReported: extractReportedTotal(payload) };
}

export function normalizeBlingCatalogPage(payload: unknown) {
  return normalizePage(record(payload) as BlingCatalogResponse);
}

function isTemporary(error: unknown) {
  return error instanceof BlingApiError && (error.code === "RATE_LIMITED" || error.code === "TEMPORARY_FAILURE");
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
}) {
  for (let attempt = 1; attempt <= maxRetryAttempts; attempt += 1) {
    try {
      const request = {
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        path: "/produtos",
        query: { pagina: input.page, limite: pageSize, criterio: input.criterion ?? 1 }
      };
      return input.readOnly
        ? await blingApiClient.requestReadOnly<BlingCatalogResponse>(request)
        : await blingApiClient.request<BlingCatalogResponse>({ ...request, method: "GET" });
    } catch (error) {
      if (!isTemporary(error) || attempt === maxRetryAttempts) throw error;
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

async function loadSkuConflicts(organizationId: string, products: NormalizedBlingProduct[], mappedIds: Set<string>) {
  const skus = [...new Set(products.filter((product) => !mappedIds.has(product.externalProductId)).map((product) => product.sku).filter((sku): sku is string => Boolean(sku)))];
  const conflicts = new Set<string>();
  for (let start = 0; start < skus.length; start += 1_000) {
    const rows = await prisma.product.findMany({
      where: { organizationId, sku: { in: skus.slice(start, start + 1_000) } },
      select: { sku: true }
    });
    for (const row of rows) if (row.sku) conflicts.add(row.sku);
  }
  return conflicts;
}

async function validateConnection(organizationId: string, connectionId: string) {
  const connection = await prisma.blingConnection.findFirst({
    where: { id: connectionId, organizationId },
    select: { id: true, status: true, tokens: { orderBy: { updatedAt: "desc" }, take: 1, select: { id: true } } }
  });
  if (!connection) throw new Error("Conta Bling nao encontrada.");
  if (connection.status === "DISCONNECTED" || !connection.tokens.length) {
    throw new Error("Reconecte a conta Bling antes de continuar.");
  }
  return connection;
}

async function fetchAllProducts(input: {
  organizationId: string;
  connectionId: string;
  readOnly: boolean;
  criterion?: 1 | 5;
}) {
  const products: NormalizedBlingProduct[] = [];
  let page = 1;
  let pagesFound = 0;
  let sourceRowsFetched = 0;
  let totalReportedByBling: number | null = null;
  let errors = 0;
  let completed = false;

  for (; page <= maxSafetyPages; page += 1) {
    let payload: BlingCatalogResponse;
    try {
      payload = await fetchCatalogPage({ ...input, page });
    } catch (error) {
      if (!isTemporary(error)) throw error;
      errors += 1;
      break;
    }
    const normalized = normalizePage(payload);
    totalReportedByBling = normalized.totalReported ?? totalReportedByBling;
    sourceRowsFetched += normalized.sourceRowCount;
    errors += normalized.invalidRows;
    products.push(...normalized.products);

    if (normalized.sourceRowCount > 0) pagesFound += 1;
    const reachedReportedTotal = totalReportedByBling !== null && sourceRowsFetched >= totalReportedByBling;
    if (normalized.sourceRowCount < pageSize || reachedReportedTotal) {
      completed = true;
      break;
    }
  }

  return { products, pagesFound, totalReportedByBling, errors, completed };
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
      isVariation: product.isVariation
    } satisfies Prisma.InputJsonObject,
    lastFetchedAt: new Date()
  };
}

async function updateLocalPrice(transaction: Prisma.TransactionClient, organizationId: string, productId: string, product: NormalizedBlingProduct) {
  if (product.price === null && product.costPrice === null) return;
  const latest = await transaction.productPrice.findFirst({
    where: { organizationId, productId },
    orderBy: { createdAt: "desc" },
    select: { id: true, salePrice: true, costPrice: true }
  });
  const salePrice = product.price ?? Number(latest?.salePrice ?? 0);
  const costPrice = product.costPrice ?? Number(latest?.costPrice ?? 0);
  if (latest) {
    await transaction.productPrice.update({ where: { id: latest.id }, data: { salePrice, costPrice } });
  } else {
    await transaction.productPrice.create({ data: { organizationId, productId, salePrice, costPrice } });
  }
}

async function updateLocalInventory(transaction: Prisma.TransactionClient, organizationId: string, connectionId: string, productId: string, stock: number | null) {
  if (stock === null) return;
  await transaction.inventoryBalance.upsert({
    where: { productId_connectionId_warehouse: { productId, connectionId, warehouse: "Bling" } },
    create: { organizationId, productId, connectionId, warehouse: "Bling", physicalQuantity: stock },
    update: { physicalQuantity: stock }
  });
}

async function applyPage(input: {
  organizationId: string;
  connectionId: string;
  erpConnectionId: string;
  jobId: string;
  page: number;
  products: NormalizedBlingProduct[];
  sourceRowCount: number;
  totalReportedByBling: number | null;
}) {
  return prisma.$transaction(async (transaction) => {
    let created = 0;
    let updated = 0;
    let ignored = 0;
    const errors = 0;

    for (const product of input.products) {
      const draft = draftData(product, input.organizationId, input.erpConnectionId, input.connectionId);
      const draftRecord = await transaction.blingProductImportDraft.upsert({
          where: {
            organizationId_blingConnectionId_externalId: {
              organizationId: input.organizationId,
              blingConnectionId: input.connectionId,
              externalId: product.externalProductId
            }
          },
          create: { ...draft, importStatus: "PENDING" },
          update: draft
      });

      const mapping = await transaction.productExternalMapping.findUnique({
          where: {
            connectionId_externalProductId: {
              connectionId: input.connectionId,
              externalProductId: product.externalProductId
            }
          },
          include: { product: { select: { id: true, sku: true, brand: true, attributes: true } } }
      });

      if (mapping) {
        let nextSku = mapping.product.sku;
        if (product.sku && product.sku !== mapping.product.sku) {
          const conflict = await transaction.product.findFirst({
              where: { organizationId: input.organizationId, sku: product.sku, id: { not: mapping.product.id } },
              select: { id: true }
          });
          if (!conflict) nextSku = product.sku;
        }
        await transaction.product.update({
            where: { id: mapping.product.id },
            data: {
              sku: nextSku,
              ean: product.gtin,
              name: product.name,
              description: product.description,
              category: product.category,
              brand: resolveProductBrandFromBling(mapping.product.brand, product.brand),
              ncm: product.ncm,
              weight: product.weight,
              height: product.height,
              width: product.width,
              depth: product.depth,
              source: "BLING",
              attributes: safeProductAttributes(mapping.product.attributes, product, input.connectionId)
            }
        });
        await updateLocalPrice(transaction, input.organizationId, mapping.product.id, product);
        await updateLocalInventory(transaction, input.organizationId, input.connectionId, mapping.product.id, product.stock);
        await transaction.productExternalMapping.update({ where: { id: mapping.id }, data: { lastExternalSyncAt: new Date() } });
        await transaction.blingProductImportDraft.update({ where: { id: draftRecord.id }, data: { importStatus: "IMPORTED" } });
        updated += 1;
        continue;
      }

      const skuConflict = product.sku
        ? await transaction.product.findFirst({ where: { organizationId: input.organizationId, sku: product.sku }, select: { id: true } })
        : null;
      if (skuConflict) {
        await transaction.blingProductImportDraft.update({
            where: { organizationId_blingConnectionId_externalId: { organizationId: input.organizationId, blingConnectionId: input.connectionId, externalId: product.externalProductId } },
            data: { importStatus: "REVIEW_REQUIRED" }
        });
        ignored += 1;
        continue;
      }

      const createdProduct = await transaction.product.create({
          data: {
            organizationId: input.organizationId,
            sku: product.sku,
            ean: product.gtin,
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
            attributes: safeProductAttributes(null, product, input.connectionId),
            mappings: {
              create: {
                organizationId: input.organizationId,
                connectionId: input.connectionId,
                externalProductId: product.externalProductId,
                lastExternalSyncAt: new Date()
              }
            }
          }
      });
      await updateLocalPrice(transaction, input.organizationId, createdProduct.id, product);
      await updateLocalInventory(transaction, input.organizationId, input.connectionId, createdProduct.id, product.stock);
      await transaction.blingProductImportDraft.update({
          where: { organizationId_blingConnectionId_externalId: { organizationId: input.organizationId, blingConnectionId: input.connectionId, externalId: product.externalProductId } },
          data: { importStatus: "IMPORTED" }
      });
      created += 1;
    }

    await transaction.erpSyncJob.update({
      where: { id: input.jobId },
      data: {
        totalFetched: { increment: input.products.length },
        totalCreatedDrafts: { increment: created },
        totalUpdatedDrafts: { increment: updated },
        totalExistingProducts: { increment: ignored },
        totalErrors: { increment: errors },
        currentPage: input.page + 1,
        lastCursor: JSON.stringify({ page: input.page, sourceRows: input.sourceRowCount, totalReported: input.totalReportedByBling })
      }
    });
    return { created, updated, ignored, errors };
  });
}

export class BlingProductImportService {
  async dryRun(input: { organizationId: string; connectionId: string }): Promise<BlingProductDryRun> {
    await validateConnection(input.organizationId, input.connectionId);
    const fetched = await fetchAllProducts({ ...input, readOnly: true });
    const uniqueProducts = new Map<string, NormalizedBlingProduct>();
    let duplicateExternalIds = 0;
    for (const product of fetched.products) {
      if (uniqueProducts.has(product.externalProductId)) duplicateExternalIds += 1;
      else uniqueProducts.set(product.externalProductId, product);
    }
    const products = [...uniqueProducts.values()];
    const mappings = await loadMappings(input.organizationId, input.connectionId, products.map((product) => product.externalProductId));
    const mappedIds = new Set(mappings.keys());
    const skuConflicts = await loadSkuConflicts(input.organizationId, products, mappedIds);
    const conflictCount = products.filter((product) => !mappedIds.has(product.externalProductId) && product.sku && skuConflicts.has(product.sku)).length;
    const existing = mappedIds.size;
    const newProducts = products.length - existing - conflictCount;

    return {
      connectionReady: true,
      totalReportedByBling: fetched.totalReportedByBling,
      totalFound: products.length,
      pagesFound: fetched.pagesFound,
      simpleProducts: products.filter((product) => !product.isVariation).length,
      variations: products.filter((product) => product.isVariation).length,
      active: products.filter((product) => product.status === "A").length,
      inactive: products.filter((product) => product.status !== "A").length,
      withoutSku: products.filter((product) => !product.sku).length,
      existing,
      new: newProducts,
      wouldUpdate: existing,
      importable: existing + newProducts,
      errors: fetched.errors,
      ignored: conflictCount + fetched.errors,
      duplicateExternalIds,
      skuConflicts: conflictCount,
      completed: fetched.completed,
      writesPerformed: false
    };
  }

  async prepareSync(input: { organizationId: string; connectionId: string }) {
    await validateConnection(input.organizationId, input.connectionId);
    const erpConnection = await prisma.eRPConnection.findUnique({
      where: { organizationId_provider: { organizationId: input.organizationId, provider: ERPProvider.BLING } },
      select: { id: true }
    });
    if (!erpConnection) throw new Error("A integracao Bling precisa ser configurada antes da sincronizacao.");

    const recentLease = new Date(Date.now() - staleJobLeaseMs);
    const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
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
          currentPage: 1
        },
        select: { id: true, status: true, currentPage: true }
      });
    });
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
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          { status: "PROCESSING", updatedAt: { lt: staleBefore } }
        ]
      }
    });
    if (!job) throw new Error("Sincronizacao nao encontrada, ja concluida ou em andamento.");
    await validateConnection(input.organizationId, input.connectionId);

    const lockKey = `bling-products:${input.organizationId}:${input.connectionId}`;
    const claimed = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
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
          OR: [
            { status: { in: ["PENDING", "FAILED"] } },
            { status: "PROCESSING", updatedAt: { lt: staleBefore } }
          ]
        },
        data: { status: "PROCESSING", startedAt: job.startedAt ?? new Date(), errorMessage: null }
      });
    });
    if (claimed.count !== 1) throw new Error("Esta sincronizacao ja esta em andamento.");

    let page = Math.max(1, job.currentPage);
    let totalReportedByBling: number | null = null;
    try {
      await this.reconcileProductStatuses({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        confirm: true
      });

      for (; page <= maxSafetyPages; page += 1) {
        const payload = await fetchCatalogPage({ organizationId: input.organizationId, connectionId: input.connectionId, page, readOnly: false });
        const normalized = normalizePage(payload);
        totalReportedByBling = normalized.totalReported ?? totalReportedByBling;
        await applyPage({
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          erpConnectionId: job.erpConnectionId,
          jobId: job.id,
          page,
          products: normalized.products,
          sourceRowCount: normalized.sourceRowCount,
          totalReportedByBling
        });

        if (normalized.sourceRowCount < pageSize) break;
      }

      await prisma.$transaction([
        prisma.erpSyncJob.update({ where: { id: job.id }, data: { status: "COMPLETED", finishedAt: new Date(), errorMessage: null } }),
        prisma.blingConnection.update({ where: { id: input.connectionId }, data: { lastProductSyncAt: new Date() } })
      ]);
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
        errorMessage: true
      }
    });
    if (!job) throw new Error("Sincronizacao nao encontrada.");
    return job;
  }
}

export const blingProductImportService = new BlingProductImportService();
