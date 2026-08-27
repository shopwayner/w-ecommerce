import { createHash } from "node:crypto";
import {
  MercadoLivreListingProjectionError,
  MercadoLivreListingProjectionService,
  mercadoLivreListingProjectionService,
  type MercadoLivreProjectionScope,
  type NormalizedMercadoLivreProjectionListing
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-service";
import {
  MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE,
  MERCADO_LIVRE_PROJECTION_DETAIL_CONCURRENCY,
  MERCADO_LIVRE_PROJECTION_FULL_SYNC_BUDGET_MS,
  MERCADO_LIVRE_PROJECTION_PAGE_SIZE,
  MercadoLivreProjectionSourceValidationError,
  normalizeMercadoLivreProjectionSourceDetail,
  type MercadoLivreProjectionCatalogMetadata,
  type MercadoLivreProjectionSyncSource
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-source";

export type MercadoLivreProjectionLifecycle = Pick<
  MercadoLivreListingProjectionService,
  | "validateProjectionScope"
  | "beginProjectionGeneration"
  | "inspectProjectionGeneration"
  | "stageProjectionListings"
  | "finalizeProjectionGeneration"
  | "failProjectionGeneration"
  | "getProjectionReadiness"
>;

export type MercadoLivreProjectionFullSyncStage =
  | "VALIDATING"
  | "READING_IDS"
  | "STAGING"
  | "RECONCILING"
  | "FINALIZING"
  | "COMPLETED"
  | "FAILED";

export type MercadoLivreProjectionFullSyncProgress = {
  stage: MercadoLivreProjectionFullSyncStage;
  generationId: string | null;
  total: number | null;
  processedIds: number;
  stagedCount: number;
  catalogPages: number;
  detailBatches: number;
};

export type MercadoLivreProjectionFullSyncTelemetry = {
  correlationId: string;
  generationId: string | null;
  total: number | null;
  staged: number;
  catalogPages: number;
  reconciliationPages: number;
  batches: number;
  maxConcurrency: number;
  durationMs: number;
  status: "COMPLETE" | "ERROR";
  errorCode: string | null;
  recoveryGenerationId?: string | null;
  recoveryDetected?: boolean;
  recoveryAction?: string;
  previousGenerationStatus?: "BUILDING" | "COMPLETE" | "ERROR" | null;
  syncOutcome?: string;
  workerLossCode?: string | null;
};

export type MercadoLivreProjectionFullSyncInput = MercadoLivreProjectionScope & {
  correlationId: string;
  recoveryGenerationId?: string;
  signal?: AbortSignal;
  budgetMs?: number;
  onProgress?: (progress: MercadoLivreProjectionFullSyncProgress) => void;
  onTelemetry?: (telemetry: MercadoLivreProjectionFullSyncTelemetry) => void;
};

export type MercadoLivreProjectionFullSyncResult = {
  status: "COMPLETE";
  generationId: string;
  expectedTotal: number;
  storedTotal: number;
  catalogHash: string;
  catalogPages: number;
  reconciliationPages: number;
  detailBatches: number;
  maxConcurrency: number;
  durationMs: number;
};

export class MercadoLivreProjectionFullSyncError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MercadoLivreProjectionFullSyncError";
  }
}

type CatalogSnapshot = {
  total: number;
  ids: string[];
  hash: string;
  pages: number;
};

type OperationAbortKind = "PROJECTION_SYNC_CANCELLED" | "PROJECTION_SYNC_BUDGET_EXCEEDED";

function fullSyncError(code: string, message: string): never {
  throw new MercadoLivreProjectionFullSyncError(code, message);
}

function requiredText(value: unknown, field: string, maxLength = 191) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) {
    fullSyncError("PROJECTION_SYNC_INVALID_INPUT", `${field} is invalid.`);
  }
  return normalized;
}

function positiveBudget(value: number | undefined) {
  const normalized = value ?? MERCADO_LIVRE_PROJECTION_FULL_SYNC_BUDGET_MS;
  if (!Number.isFinite(normalized) || !Number.isSafeInteger(normalized) || normalized <= 0) {
    fullSyncError("PROJECTION_SYNC_INVALID_INPUT", "budgetMs is invalid.");
  }
  return normalized;
}

function normalizedTotal(value: unknown) {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 2_147_483_647
  ) {
    fullSyncError("PROJECTION_CATALOG_METADATA_INVALID", "Projection catalog total is invalid.");
  }
  return value;
}

function normalizedMlbId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^MLB[0-9]+$/.test(normalized) || normalized !== value) {
    fullSyncError("PROJECTION_CATALOG_ID_INVALID", "Projection catalog contains an invalid ID.");
  }
  return normalized;
}

function hashCatalogIds(ids: string[]) {
  return createHash("sha256")
    .update([...ids].sort().join("\n"), "utf8")
    .digest("hex");
}

function emitProgress(
  callback: MercadoLivreProjectionFullSyncInput["onProgress"],
  progress: MercadoLivreProjectionFullSyncProgress
) {
  try {
    callback?.(progress);
  } catch {
    // Progress observers must not change projection integrity.
  }
}

function emitTelemetry(
  callback: MercadoLivreProjectionFullSyncInput["onTelemetry"],
  telemetry: MercadoLivreProjectionFullSyncTelemetry
) {
  try {
    callback?.(telemetry);
  } catch {
    // Telemetry observers must not change projection integrity.
  }
}

function createOperationAbort(input: { externalSignal?: AbortSignal; budgetMs: number }) {
  const controller = new AbortController();
  let abortKind: OperationAbortKind | null = null;
  const abort = (kind: OperationAbortKind) => {
    if (controller.signal.aborted) return;
    abortKind = kind;
    controller.abort(kind);
  };
  const onExternalAbort = () => abort("PROJECTION_SYNC_CANCELLED");
  if (input.externalSignal?.aborted) onExternalAbort();
  else input.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(
    () => abort("PROJECTION_SYNC_BUDGET_EXCEEDED"),
    input.budgetMs
  );
  timer.unref?.();

  return {
    signal: controller.signal,
    abortKind: () => abortKind,
    dispose() {
      clearTimeout(timer);
      input.externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

function throwIfAborted(signal: AbortSignal, abortKind: () => OperationAbortKind | null) {
  if (!signal.aborted) return;
  const code = abortKind() ?? "PROJECTION_SYNC_CANCELLED";
  fullSyncError(
    code,
    code === "PROJECTION_SYNC_BUDGET_EXCEEDED"
      ? "Projection full sync exceeded its execution budget."
      : "Projection full sync was cancelled."
  );
}

function validateMetadata(
  metadata: MercadoLivreProjectionCatalogMetadata,
  expectedSellerId: string
) {
  if (metadata.sellerId !== expectedSellerId) {
    fullSyncError(
      "PROJECTION_SOURCE_SELLER_MISMATCH",
      "Projection source returned an unexpected seller."
    );
  }
  return normalizedTotal(metadata.total);
}

async function readCatalogSnapshot(input: {
  source: MercadoLivreProjectionSyncSource;
  scope: MercadoLivreProjectionScope;
  metadata: MercadoLivreProjectionCatalogMetadata;
  signal: AbortSignal;
  abortKind: () => OperationAbortKind | null;
}): Promise<CatalogSnapshot> {
  const total = validateMetadata(input.metadata, input.scope.sellerId);
  const ids: string[] = [];
  const uniqueIds = new Set<string>();
  let pages = 0;

  for (let offset = 0; offset < total; offset += MERCADO_LIVRE_PROJECTION_PAGE_SIZE) {
    throwIfAborted(input.signal, input.abortKind);
    const page = await input.source.listCatalogPage({
      ...input.scope,
      offset,
      limit: MERCADO_LIVRE_PROJECTION_PAGE_SIZE,
      signal: input.signal
    });
    throwIfAborted(input.signal, input.abortKind);
    pages += 1;
    if (page.sellerId !== input.scope.sellerId) {
      fullSyncError(
        "PROJECTION_SOURCE_SELLER_MISMATCH",
        "Projection catalog page belongs to an unexpected seller."
      );
    }
    if (page.offset !== offset || normalizedTotal(page.total) !== total) {
      fullSyncError(
        "PROJECTION_PAGINATION_INVALID",
        "Projection catalog pagination metadata is inconsistent."
      );
    }
    if (!Array.isArray(page.ids)) {
      fullSyncError("PROJECTION_PAGINATION_INVALID", "Projection catalog page is invalid.");
    }
    const expectedPageSize = Math.min(MERCADO_LIVRE_PROJECTION_PAGE_SIZE, total - offset);
    if (page.ids.length !== expectedPageSize) {
      fullSyncError(
        "PROJECTION_PAGINATION_INCOMPLETE",
        "Projection catalog page has an unexpected number of IDs."
      );
    }
    for (const rawId of page.ids) {
      const id = normalizedMlbId(rawId);
      if (uniqueIds.has(id)) {
        fullSyncError(
          "PROJECTION_CATALOG_DUPLICATE_ID",
          "Projection catalog contains duplicate IDs."
        );
      }
      uniqueIds.add(id);
      ids.push(id);
    }
  }

  if (ids.length !== total || uniqueIds.size !== total) {
    fullSyncError(
      "PROJECTION_CATALOG_INCOMPLETE",
      "Projection catalog coverage is incomplete."
    );
  }
  return { total, ids, hash: hashCatalogIds(ids), pages };
}

function chunkIds(ids: string[]) {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + MERCADO_LIVRE_PROJECTION_DETAIL_BATCH_SIZE));
  }
  return batches;
}

function createLinkedAbortController(parentSignal: AbortSignal) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  return {
    controller,
    dispose: () => parentSignal.removeEventListener("abort", onParentAbort)
  };
}

async function runWithLimitedConcurrency<T>(input: {
  values: T[];
  concurrency: number;
  parentSignal: AbortSignal;
  worker: (value: T, signal: AbortSignal) => Promise<void>;
}) {
  if (input.values.length === 0) return;
  const linked = createLinkedAbortController(input.parentSignal);
  let nextIndex = 0;
  let firstError: unknown = null;
  const workerCount = Math.min(input.concurrency, input.values.length);
  try {
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (!linked.controller.signal.aborted && firstError === null) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= input.values.length) return;
        try {
          await input.worker(input.values[index], linked.controller.signal);
        } catch (error) {
          if (firstError === null) {
            firstError = error;
            linked.controller.abort(error);
          }
        }
      }
    }));
  } finally {
    linked.dispose();
  }
  if (firstError !== null) throw firstError;
}

function normalizedDetails(input: {
  requestedIds: string[];
  details: Awaited<ReturnType<MercadoLivreProjectionSyncSource["getListingDetails"]>>;
  sellerId: string;
  syncedAt: Date;
}) {
  if (!Array.isArray(input.details) || input.details.length !== input.requestedIds.length) {
    fullSyncError(
      "PROJECTION_DETAIL_COVERAGE_MISMATCH",
      "Projection detail response does not cover the requested IDs."
    );
  }
  const requested = new Set(input.requestedIds);
  const byId = new Map<string, NormalizedMercadoLivreProjectionListing>();
  for (const detail of input.details) {
    const id = normalizedMlbId(detail?.mlbId);
    if (!requested.has(id)) {
      fullSyncError(
        "PROJECTION_DETAIL_UNEXPECTED_ID",
        "Projection detail response contains an unexpected ID."
      );
    }
    if (byId.has(id)) {
      fullSyncError(
        "PROJECTION_DETAIL_DUPLICATE_ID",
        "Projection detail response contains a duplicate ID."
      );
    }
    byId.set(id, normalizeMercadoLivreProjectionSourceDetail({
      detail,
      expectedSellerId: input.sellerId,
      syncedAt: input.syncedAt
    }));
  }
  if (byId.size !== requested.size) {
    fullSyncError(
      "PROJECTION_DETAIL_COVERAGE_MISMATCH",
      "Projection detail response is missing requested IDs."
    );
  }
  return input.requestedIds.map((id) => byId.get(id)!);
}

function classifyFailure(
  error: unknown,
  abortKind: () => OperationAbortKind | null
) {
  const aborted = abortKind();
  if (aborted) {
    return new MercadoLivreProjectionFullSyncError(
      aborted,
      aborted === "PROJECTION_SYNC_BUDGET_EXCEEDED"
        ? "Projection full sync exceeded its execution budget."
        : "Projection full sync was cancelled."
    );
  }
  if (error instanceof MercadoLivreProjectionFullSyncError) return error;
  if (error instanceof MercadoLivreProjectionSourceValidationError) {
    return new MercadoLivreProjectionFullSyncError(error.code, error.message);
  }
  if (error instanceof MercadoLivreListingProjectionError) {
    return new MercadoLivreProjectionFullSyncError(error.code, error.message);
  }
  return new MercadoLivreProjectionFullSyncError(
    "PROJECTION_SOURCE_FAILED",
    "Projection source failed during full synchronization."
  );
}

export class MercadoLivreListingProjectionFullSyncService {
  constructor(private readonly dependencies: {
    source: MercadoLivreProjectionSyncSource;
    lifecycle?: MercadoLivreProjectionLifecycle;
    now?: () => Date;
    monotonicNow?: () => number;
  }) {}

  async validateScope(input: MercadoLivreProjectionScope) {
    const lifecycle = this.dependencies.lifecycle ?? mercadoLivreListingProjectionService;
    return lifecycle.validateProjectionScope(input);
  }

  async inspectRecoveryGeneration(input: MercadoLivreProjectionScope & {
    generationId: string;
  }) {
    const lifecycle = this.dependencies.lifecycle ?? mercadoLivreListingProjectionService;
    return lifecycle.inspectProjectionGeneration(input);
  }

  async abortRecoveryGeneration(input: MercadoLivreProjectionScope & {
    generationId: string;
    errorCode: string;
    errorSummary: string;
  }) {
    const lifecycle = this.dependencies.lifecycle ?? mercadoLivreListingProjectionService;
    return lifecycle.failProjectionGeneration(input);
  }

  async fullSync(input: MercadoLivreProjectionFullSyncInput): Promise<MercadoLivreProjectionFullSyncResult> {
    const lifecycle = this.dependencies.lifecycle ?? mercadoLivreListingProjectionService;
    const scope: MercadoLivreProjectionScope = {
      organizationId: requiredText(input.organizationId, "organizationId"),
      marketplaceConnectionId: requiredText(
        input.marketplaceConnectionId,
        "marketplaceConnectionId"
      ),
      sellerId: requiredText(input.sellerId, "sellerId")
    };
    const correlationId = requiredText(input.correlationId, "correlationId");
    const recoveryGenerationId = input.recoveryGenerationId === undefined
      ? undefined
      : requiredText(input.recoveryGenerationId, "recoveryGenerationId");
    const budgetMs = positiveBudget(input.budgetMs);
    const now = this.dependencies.now ?? (() => new Date());
    const monotonicNow = this.dependencies.monotonicNow ?? (() => performance.now());
    const startedAt = monotonicNow();
    const operation = createOperationAbort({ externalSignal: input.signal, budgetMs });
    let generationId: string | null = null;
    let total: number | null = null;
    let processedIds = 0;
    let stagedCount = 0;
    let catalogPages = 0;
    let reconciliationPages = 0;
    let detailBatches = 0;
    let activeDetailBatches = 0;
    let maxConcurrency = 0;

    const progress = (stage: MercadoLivreProjectionFullSyncStage) => emitProgress(
      input.onProgress,
      {
        stage,
        generationId,
        total,
        processedIds,
        stagedCount,
        catalogPages,
        detailBatches
      }
    );

    try {
      progress("VALIDATING");
      throwIfAborted(operation.signal, operation.abortKind);
      await lifecycle.validateProjectionScope(scope);
      const identity = await this.dependencies.source.resolveIdentity({
        ...scope,
        signal: operation.signal
      });
      throwIfAborted(operation.signal, operation.abortKind);
      if (identity.sellerId !== scope.sellerId) {
        fullSyncError(
          "PROJECTION_SOURCE_SELLER_MISMATCH",
          "Projection source identity does not match the requested seller."
        );
      }

      progress("READING_IDS");
      const initialMetadata = await this.dependencies.source.getCatalogMetadata({
        ...scope,
        signal: operation.signal
      });
      total = validateMetadata(initialMetadata, scope.sellerId);
      const begun = await lifecycle.beginProjectionGeneration({
        ...scope,
        expectedTotal: total,
        generationId: recoveryGenerationId
      });
      generationId = begun.generation.id;
      const initialCatalog = await readCatalogSnapshot({
        source: this.dependencies.source,
        scope,
        metadata: initialMetadata,
        signal: operation.signal,
        abortKind: operation.abortKind
      });
      catalogPages = initialCatalog.pages;
      progress("STAGING");

      const batches = chunkIds(initialCatalog.ids);
      await runWithLimitedConcurrency({
        values: batches,
        concurrency: MERCADO_LIVRE_PROJECTION_DETAIL_CONCURRENCY,
        parentSignal: operation.signal,
        worker: async (ids, signal) => {
          throwIfAborted(signal, operation.abortKind);
          activeDetailBatches += 1;
          maxConcurrency = Math.max(maxConcurrency, activeDetailBatches);
          detailBatches += 1;
          try {
            const details = await this.dependencies.source.getListingDetails({
              ...scope,
              ids,
              signal
            });
            throwIfAborted(signal, operation.abortKind);
            const listings = normalizedDetails({
              requestedIds: ids,
              details,
              sellerId: scope.sellerId,
              syncedAt: now()
            });
            throwIfAborted(signal, operation.abortKind);
            await lifecycle.stageProjectionListings({
              ...scope,
              generationId: generationId!,
              listings
            });
            processedIds += ids.length;
            stagedCount += listings.length;
            progress("STAGING");
          } finally {
            activeDetailBatches -= 1;
          }
        }
      });
      throwIfAborted(operation.signal, operation.abortKind);

      progress("RECONCILING");
      const finalMetadata = await this.dependencies.source.getCatalogMetadata({
        ...scope,
        signal: operation.signal
      });
      const finalTotal = validateMetadata(finalMetadata, scope.sellerId);
      if (finalTotal !== initialCatalog.total) {
        fullSyncError(
          "PROJECTION_SOURCE_CHANGED",
          "Projection source changed during full synchronization."
        );
      }
      const finalCatalog = await readCatalogSnapshot({
        source: this.dependencies.source,
        scope,
        metadata: finalMetadata,
        signal: operation.signal,
        abortKind: operation.abortKind
      });
      reconciliationPages = finalCatalog.pages;
      if (
        finalCatalog.total !== initialCatalog.total
        || finalCatalog.hash !== initialCatalog.hash
      ) {
        fullSyncError(
          "PROJECTION_SOURCE_CHANGED",
          "Projection source changed during full synchronization."
        );
      }

      progress("FINALIZING");
      const finalized = await lifecycle.finalizeProjectionGeneration({
        ...scope,
        generationId,
        expectedTotal: initialCatalog.total
      });
      if (finalized.status !== "COMPLETE" || !finalized.activated) {
        fullSyncError(
          finalized.errorCode ?? "PROJECTION_FINALIZE_FAILED",
          "Projection generation could not be activated."
        );
      }
      const durationMs = Math.max(0, monotonicNow() - startedAt);
      progress("COMPLETED");
      emitTelemetry(input.onTelemetry, {
        correlationId,
        generationId,
        total,
        staged: stagedCount,
        catalogPages,
        reconciliationPages,
        batches: detailBatches,
        maxConcurrency,
        durationMs,
        status: "COMPLETE",
        errorCode: null
      });
      return {
        status: "COMPLETE",
        generationId,
        expectedTotal: initialCatalog.total,
        storedTotal: finalized.storedTotal,
        catalogHash: initialCatalog.hash,
        catalogPages,
        reconciliationPages,
        detailBatches,
        maxConcurrency,
        durationMs
      };
    } catch (error) {
      let failure = classifyFailure(error, operation.abortKind);
      if (generationId) {
        try {
          await lifecycle.failProjectionGeneration({
            ...scope,
            generationId,
            errorCode: failure.code,
            errorSummary: failure.message
          });
        } catch {
          failure = new MercadoLivreProjectionFullSyncError(
            "PROJECTION_FAIL_GENERATION_FAILED",
            "Projection generation could not be marked as failed."
          );
        }
      }
      const durationMs = Math.max(0, monotonicNow() - startedAt);
      progress("FAILED");
      emitTelemetry(input.onTelemetry, {
        correlationId,
        generationId,
        total,
        staged: stagedCount,
        catalogPages,
        reconciliationPages,
        batches: detailBatches,
        maxConcurrency,
        durationMs,
        status: "ERROR",
        errorCode: failure.code
      });
      throw failure;
    } finally {
      operation.dispose();
    }
  }
}
