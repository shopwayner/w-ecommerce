import { Prisma, type PrismaClient } from "@prisma/client";

import {
  extractBlingProductBrandAnalysis,
  normalizeProductBrand,
  type ProductBrandAnalysis
} from "@/lib/product-brand";
import { prisma } from "@/lib/prisma";
import { BlingApiError, blingApiClient } from "@/lib/services/bling-api-client";

export type BlingProductBrandBackfillRow = {
  mappingId: string;
  organizationId: string;
  connectionId: string;
  externalProductId: string;
  productId: string;
  productSku: string | null;
  productBrand: string | null;
  productUpdatedAt: Date;
};

export type BlingProductBrandBackfillExample = {
  sku: string;
  localBrand: string | null;
  blingBrand: string;
  action: "UPDATE_BRAND";
};

export type BlingProductBrandBackfillPlanEntry = {
  productId: string;
  sku: string;
  previousBrand: string | null;
  newBrand: string;
};

export type BlingProductBrandSampleResult = {
  sku: string;
  localBrand: string | null;
  remoteBrand: string | null;
  normalizedBrand: string | null;
  wouldEnterBackfill: boolean;
  status: "VALID" | "EMPTY" | "GENERIC" | "NOT_FOUND" | "ERROR" | "NOT_CONSULTED";
};

export type BlingProductBrandBackfillReport = {
  mode: "DRY_RUN" | "CONFIRMED";
  linkedProducts: number;
  candidateProducts: number;
  alreadyWithValidBrand: number;
  withoutValidBrandBefore: number;
  totalConsulted: number;
  remoteGets: number;
  remoteRequests: number;
  validBrandsFound: number;
  recordsWouldChange: number;
  recordsAlreadyCorrect: number;
  withoutRemoteBrand: number;
  genericBrandsDiscarded: number;
  withoutValidBrandAfter: number;
  notFound: number;
  errors401: number;
  errors403: number;
  errors404: number;
  errors429: number;
  otherErrors: number;
  retries: number;
  remoteReadFailures: number;
  abortedByAuthentication: boolean;
  abortedByPermission: boolean;
  concurrentUpdates: number;
  identityMismatches: number;
  writesPerformed: number;
  externalWritesPerformed: 0;
  productUpdatedAtPreserved: true;
  durationMs: number;
  examples: BlingProductBrandBackfillExample[];
  samples: BlingProductBrandSampleResult[];
};

type BrandUpdateOutcome = "UPDATED" | "CONCURRENT_UPDATE" | "IDENTITY_MISMATCH";

export type BlingProductBrandBackfillDependencies = {
  listLinkedProducts(input: { organizationId: string; connectionId: string }): Promise<BlingProductBrandBackfillRow[]>;
  fetchProductDetail(row: BlingProductBrandBackfillRow): Promise<unknown>;
  updateProductBrand(input: {
    row: BlingProductBrandBackfillRow;
    currentBrand: string | null;
    brand: string;
  }): Promise<BrandUpdateOutcome>;
  wait?(milliseconds: number): Promise<void>;
};

type RemoteMetrics = {
  remoteRequests: number;
  retries: number;
  notFound: number;
  errors401: number;
  errors403: number;
  errors404: number;
  errors429: number;
  otherErrors: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function extractBrandAnalysisFromBlingProductDetail(payload: unknown): ProductBrandAnalysis {
  const wrapper = record(payload);
  const product = Object.keys(record(wrapper.data)).length ? record(wrapper.data) : wrapper;
  return extractBlingProductBrandAnalysis(product);
}

function sanitizedSku(value: string | null) {
  const sku = value?.trim() ?? "";
  return /^[A-Za-z0-9._/-]{1,80}$/.test(sku) ? sku : "SEM_SKU";
}

function retryDelay(error: BlingApiError) {
  if (error.status === 429) {
    const seconds = Math.max(1, Math.min(error.retryAfter ?? 2, 15));
    return seconds * 1_000;
  }
  return 1_500;
}

function countFinalFailure(metrics: RemoteMetrics, error: unknown) {
  if (!(error instanceof BlingApiError)) {
    metrics.otherErrors += 1;
    return;
  }
  if (error.status === 401) metrics.errors401 += 1;
  else if (error.status === 403) metrics.errors403 += 1;
  else if (error.status === 404) {
    metrics.errors404 += 1;
    metrics.notFound += 1;
  } else if (error.status === 429) metrics.errors429 += 1;
  else metrics.otherErrors += 1;
}

async function fetchWithLimitedRetry(input: {
  row: BlingProductBrandBackfillRow;
  dependencies: BlingProductBrandBackfillDependencies;
  metrics: RemoteMetrics;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    input.metrics.remoteRequests += 1;
    try {
      return { payload: await input.dependencies.fetchProductDetail(input.row), error: null };
    } catch (error) {
      const retryable = error instanceof BlingApiError && (error.status === 429 || error.status >= 500);
      if (retryable && attempt === 0) {
        input.metrics.retries += 1;
        await (input.dependencies.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(
          retryDelay(error)
        );
        continue;
      }
      countFinalFailure(input.metrics, error);
      return { payload: null, error };
    }
  }
  return { payload: null, error: new Error("Consulta remota inconclusiva.") };
}

export async function runBlingProductBrandBackfill(input: {
  organizationId: string;
  connectionId: string;
  confirm: boolean;
  dependencies: BlingProductBrandBackfillDependencies;
  inspectSkus?: string[];
  onProgress?(progress: { consulted: number; candidates: number; retries: number }): void;
  onPlanReady?(plan: readonly BlingProductBrandBackfillPlanEntry[]): Promise<void>;
}): Promise<BlingProductBrandBackfillReport> {
  const startedAt = Date.now();
  const rows = await input.dependencies.listLinkedProducts({
    organizationId: input.organizationId,
    connectionId: input.connectionId
  });
  const candidates = rows.filter((row) => !normalizeProductBrand(row.productBrand));
  const inspectedSkus = new Set(input.inspectSkus ?? []);
  const samplesBySku = new Map<string, BlingProductBrandSampleResult>();
  const examples: BlingProductBrandBackfillExample[] = [];
  const plannedUpdates: Array<{
    row: BlingProductBrandBackfillRow;
    sku: string;
    brand: string;
  }> = [];
  const metrics: RemoteMetrics = {
    remoteRequests: 0,
    retries: 0,
    notFound: 0,
    errors401: 0,
    errors403: 0,
    errors404: 0,
    errors429: 0,
    otherErrors: 0
  };

  let totalConsulted = 0;
  let validBrandsFound = 0;
  let withoutRemoteBrand = 0;
  let genericBrandsDiscarded = 0;
  let concurrentUpdates = 0;
  let identityMismatches = 0;
  let writesPerformed = 0;
  let abortedByAuthentication = false;
  let abortedByPermission = false;

  for (const row of candidates) {
    totalConsulted += 1;
    const result = await fetchWithLimitedRetry({ row, dependencies: input.dependencies, metrics });
    if (totalConsulted % 250 === 0 || totalConsulted === candidates.length) {
      input.onProgress?.({ consulted: totalConsulted, candidates: candidates.length, retries: metrics.retries });
    }
    const sku = sanitizedSku(row.productSku);
    if (result.error) {
      const status = result.error instanceof BlingApiError ? result.error.status : 0;
      if (inspectedSkus.has(sku)) {
        samplesBySku.set(sku, {
          sku,
          localBrand: normalizeProductBrand(row.productBrand),
          remoteBrand: null,
          normalizedBrand: null,
          wouldEnterBackfill: false,
          status: status === 404 ? "NOT_FOUND" : "ERROR"
        });
      }
      if (status === 401) {
        abortedByAuthentication = true;
        break;
      }
      if (status === 403) {
        abortedByPermission = true;
        break;
      }
      continue;
    }

    const analysis = extractBrandAnalysisFromBlingProductDetail(result.payload);
    if (!analysis.brand) {
      if (analysis.rejection === "GENERIC") genericBrandsDiscarded += 1;
      else withoutRemoteBrand += 1;
      if (inspectedSkus.has(sku)) {
        samplesBySku.set(sku, {
          sku,
          localBrand: normalizeProductBrand(row.productBrand),
          remoteBrand: null,
          normalizedBrand: null,
          wouldEnterBackfill: false,
          status: analysis.rejection === "GENERIC" ? "GENERIC" : "EMPTY"
        });
      }
      continue;
    }

    validBrandsFound += 1;
    if (examples.length < 5) {
      examples.push({
        sku,
        localBrand: normalizeProductBrand(row.productBrand),
        blingBrand: analysis.brand,
        action: "UPDATE_BRAND"
      });
    }
    if (inspectedSkus.has(sku)) {
      samplesBySku.set(sku, {
        sku,
        localBrand: normalizeProductBrand(row.productBrand),
        remoteBrand: analysis.brand,
        normalizedBrand: analysis.brand,
        wouldEnterBackfill: true,
        status: "VALID"
      });
    }
    if (input.confirm) plannedUpdates.push({ row, sku, brand: analysis.brand });
  }

  if (input.confirm && !abortedByAuthentication && !abortedByPermission) {
    await input.onPlanReady?.(plannedUpdates.map(({ row, sku, brand }) => ({
      productId: row.productId,
      sku,
      previousBrand: normalizeProductBrand(row.productBrand),
      newBrand: brand
    })));

    for (const planned of plannedUpdates) {
      const outcome = await input.dependencies.updateProductBrand({
        row: planned.row,
        currentBrand: planned.row.productBrand,
        brand: planned.brand
      });
      if (outcome === "UPDATED") writesPerformed += 1;
      else if (outcome === "CONCURRENT_UPDATE") concurrentUpdates += 1;
      else identityMismatches += 1;
    }
  }

  for (const sku of inspectedSkus) {
    if (!samplesBySku.has(sku)) {
      samplesBySku.set(sku, {
        sku,
        localBrand: null,
        remoteBrand: null,
        normalizedBrand: null,
        wouldEnterBackfill: false,
        status: "NOT_CONSULTED"
      });
    }
  }

  const remoteReadFailures = metrics.errors401 + metrics.errors403 + metrics.errors404 + metrics.errors429 + metrics.otherErrors;
  const remainingCandidates = candidates.length - validBrandsFound;
  return {
    mode: input.confirm ? "CONFIRMED" : "DRY_RUN",
    linkedProducts: rows.length,
    candidateProducts: candidates.length,
    alreadyWithValidBrand: rows.length - candidates.length,
    withoutValidBrandBefore: candidates.length,
    totalConsulted,
    remoteGets: totalConsulted,
    remoteRequests: metrics.remoteRequests,
    validBrandsFound,
    recordsWouldChange: validBrandsFound,
    recordsAlreadyCorrect: rows.length - candidates.length,
    withoutRemoteBrand,
    genericBrandsDiscarded,
    withoutValidBrandAfter: remainingCandidates,
    notFound: metrics.notFound,
    errors401: metrics.errors401,
    errors403: metrics.errors403,
    errors404: metrics.errors404,
    errors429: metrics.errors429,
    otherErrors: metrics.otherErrors,
    retries: metrics.retries,
    remoteReadFailures,
    abortedByAuthentication,
    abortedByPermission,
    concurrentUpdates,
    identityMismatches,
    writesPerformed,
    externalWritesPerformed: 0,
    productUpdatedAtPreserved: true,
    durationMs: Date.now() - startedAt,
    examples,
    samples: [...samplesBySku.values()]
  };
}

export function createPrismaBlingProductBrandBackfillDependencies(
  client: PrismaClient = prisma
): BlingProductBrandBackfillDependencies {
  return {
    async listLinkedProducts(input) {
      const mappings = await client.productExternalMapping.findMany({
        where: {
          organizationId: input.organizationId,
          connectionId: input.connectionId
        },
        select: {
          id: true,
          organizationId: true,
          connectionId: true,
          externalProductId: true,
          productId: true,
          product: {
            select: {
              sku: true,
              brand: true,
              updatedAt: true
            }
          }
        },
        orderBy: { id: "asc" }
      });

      return mappings.map((mapping) => ({
        mappingId: mapping.id,
        organizationId: mapping.organizationId,
        connectionId: mapping.connectionId,
        externalProductId: mapping.externalProductId,
        productId: mapping.productId,
        productSku: mapping.product.sku,
        productBrand: mapping.product.brand,
        productUpdatedAt: mapping.product.updatedAt
      }));
    },
    fetchProductDetail(row) {
      return blingApiClient.requestReadOnly<unknown>({
        organizationId: row.organizationId,
        connectionId: row.connectionId,
        path: `/produtos/${row.externalProductId}`,
        timeoutMs: 30_000
      });
    },
    async updateProductBrand(input) {
      const updated = await client.$executeRaw(Prisma.sql`
        UPDATE "Product" AS product
        SET "brand" = ${input.brand}
        WHERE product.id = ${input.row.productId}
          AND product."organizationId" = ${input.row.organizationId}
          AND product."updatedAt" = ${input.row.productUpdatedAt}
          AND product."brand" IS NOT DISTINCT FROM ${input.currentBrand}
          AND EXISTS (
            SELECT 1
            FROM "ProductExternalMapping" AS mapping
            WHERE mapping.id = ${input.row.mappingId}
              AND mapping."organizationId" = ${input.row.organizationId}
              AND mapping."connectionId" = ${input.row.connectionId}
              AND mapping."externalProductId" = ${input.row.externalProductId}
              AND mapping."productId" = ${input.row.productId}
          )
      `);
      if (updated === 1) return "UPDATED";

      const identity = await client.productExternalMapping.findFirst({
        where: {
          id: input.row.mappingId,
          organizationId: input.row.organizationId,
          connectionId: input.row.connectionId,
          externalProductId: input.row.externalProductId,
          productId: input.row.productId
        },
        select: { id: true }
      });
      return identity ? "CONCURRENT_UPDATE" : "IDENTITY_MISMATCH";
    }
  };
}
