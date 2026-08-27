import type {
  MercadoLivreListingProjectionFullSyncService,
  MercadoLivreProjectionFullSyncProgress,
  MercadoLivreProjectionFullSyncResult,
  MercadoLivreProjectionFullSyncTelemetry
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-full-sync-service";
import {
  isMercadoLivreProjectionRetentionEnabled,
  parseMercadoLivreProjectionRetentionPolicy,
  type MercadoLivreProjectionRetentionEnvironment
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-retention-config";
import {
  MercadoLivreListingProjectionRetentionService,
  mercadoLivreListingProjectionRetentionService
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-retention-service";

export const MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME =
  "mercado-livre-listing-projection";

export const MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS = [
  "INITIAL_BACKFILL",
  "PERIODIC_RECONCILIATION",
  "MANUAL_REFRESH",
  "RECOVERY"
] as const;

export type MercadoLivreProjectionSyncTriggerReason =
  (typeof MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS)[number];

export type MercadoLivreProjectionSyncJobData = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
  correlationId: string;
  reason: MercadoLivreProjectionSyncTriggerReason;
  requestedBy?: string | null;
};

export type MercadoLivreProjectionSyncJobOptions = {
  signal?: AbortSignal;
  budgetMs?: number;
  onProgress?: (progress: MercadoLivreProjectionFullSyncProgress) => void;
  onTelemetry?: (telemetry: MercadoLivreProjectionFullSyncTelemetry) => void;
};

type FullSyncProcessor = Pick<MercadoLivreListingProjectionFullSyncService, "fullSync"> & Partial<
  Pick<
    MercadoLivreListingProjectionFullSyncService,
    "inspectRecoveryGeneration" | "abortRecoveryGeneration"
  >
>;
type RetentionProcessor = Pick<
  MercadoLivreListingProjectionRetentionService,
  "planRetention" | "applyRetention"
>;

export const MERCADO_LIVRE_PROJECTION_RETENTION_OUTCOMES = [
  "NOT_RUN_SYNC_FAILED",
  "SKIPPED_DISABLED",
  "NOOP",
  "APPLIED",
  "SKIPPED_BUILDING",
  "FAILED"
] as const;

export type MercadoLivreProjectionRetentionOutcome =
  (typeof MERCADO_LIVRE_PROJECTION_RETENTION_OUTCOMES)[number];

export type MercadoLivreProjectionRetentionTelemetry = {
  retentionEnabled: boolean;
  retentionOutcome: MercadoLivreProjectionRetentionOutcome;
  retentionDeletedGenerations: number;
  retentionDeletedListings: number;
  retentionDurationMs: number;
  retentionErrorCode: string | null;
};

export const MERCADO_LIVRE_PROJECTION_SYNC_OUTCOMES = [
  "NORMAL_EXECUTION",
  "RECOVERED_BEFORE_BEGIN",
  "RECOVERED_BUILDING_ABORTED",
  "RECOVERED_ALREADY_COMPLETE",
  "RECOVERED_COMPLETE_RETENTION_APPLIED",
  "RECOVERED_COMPLETE_RETENTION_NOOP",
  "RECOVERY_SCOPE_MISMATCH"
] as const;

export type MercadoLivreProjectionSyncOutcome =
  (typeof MERCADO_LIVRE_PROJECTION_SYNC_OUTCOMES)[number];

export type MercadoLivreProjectionRecoveryContext = {
  generationId: string;
  recoveryDetected: boolean;
  stalledCounter: number;
  attemptsStarted: number;
  attemptsMade: number;
};

export type MercadoLivreProjectionRecoveryMetadata = {
  recoveryGenerationId: string | null;
  recoveryDetected: boolean;
  recoveryAction: MercadoLivreProjectionSyncOutcome;
  previousGenerationStatus: "BUILDING" | "COMPLETE" | "ERROR" | null;
  syncOutcome: MercadoLivreProjectionSyncOutcome;
  workerLossCode: string | null;
};

type RecoveredCompleteSyncResult = {
  status: "COMPLETE";
  generationId: string;
  expectedTotal: number;
  storedTotal: number;
  durationMs: number;
};

export type MercadoLivreProjectionSyncJobResult = (
  MercadoLivreProjectionFullSyncResult | RecoveredCompleteSyncResult
) & MercadoLivreProjectionRetentionTelemetry & MercadoLivreProjectionRecoveryMetadata;

export class MercadoLivreProjectionJobRecoveryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MercadoLivreProjectionJobRecoveryError";
  }
}

function requiredJobText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 191) {
    throw new Error(`Invalid Mercado Livre projection job ${field}.`);
  }
  return normalized;
}

export function normalizeMercadoLivreProjectionSyncJobData(
  input: MercadoLivreProjectionSyncJobData
) {
  if (!MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS.includes(input.reason)) {
    throw new Error("Invalid Mercado Livre projection job reason.");
  }
  const requestedBy = input.requestedBy === null || input.requestedBy === undefined
    ? null
    : requiredJobText(input.requestedBy, "requestedBy");
  return {
    organizationId: requiredJobText(input.organizationId, "organizationId"),
    marketplaceConnectionId: requiredJobText(
      input.marketplaceConnectionId,
      "marketplaceConnectionId"
    ),
    sellerId: requiredJobText(input.sellerId, "sellerId"),
    correlationId: requiredJobText(input.correlationId, "correlationId"),
    reason: input.reason,
    requestedBy
  };
}

function safeRetentionErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code).trim();
    if (code) return code.slice(0, 120);
  }
  return "PROJECTION_RETENTION_FAILED";
}

async function runPostSyncRetention(input: {
  scope: Pick<
    MercadoLivreProjectionSyncJobData,
    "organizationId" | "marketplaceConnectionId" | "sellerId"
  >;
  environment: MercadoLivreProjectionRetentionEnvironment;
  retentionService: RetentionProcessor;
}): Promise<MercadoLivreProjectionRetentionTelemetry> {
  const retentionEnabled = isMercadoLivreProjectionRetentionEnabled(input.environment);
  if (!retentionEnabled) {
    return {
      retentionEnabled: false,
      retentionOutcome: "SKIPPED_DISABLED",
      retentionDeletedGenerations: 0,
      retentionDeletedListings: 0,
      retentionDurationMs: 0,
      retentionErrorCode: null
    };
  }

  const startedAt = performance.now();
  try {
    const plan = await input.retentionService.planRetention({
      scope: input.scope,
      policy: parseMercadoLivreProjectionRetentionPolicy(input.environment)
    });
    const applied = await input.retentionService.applyRetention(plan);
    const durationMs = Math.max(0, performance.now() - startedAt);
    if (applied.skippedReason === "BUILDING_PRESENT") {
      return {
        retentionEnabled: true,
        retentionOutcome: "SKIPPED_BUILDING",
        retentionDeletedGenerations: 0,
        retentionDeletedListings: 0,
        retentionDurationMs: durationMs,
        retentionErrorCode: null
      };
    }
    if (applied.skippedReason) {
      return {
        retentionEnabled: true,
        retentionOutcome: "FAILED",
        retentionDeletedGenerations: 0,
        retentionDeletedListings: 0,
        retentionDurationMs: durationMs,
        retentionErrorCode: `PROJECTION_RETENTION_${applied.skippedReason}`.slice(0, 120)
      };
    }
    return {
      retentionEnabled: true,
      retentionOutcome: applied.deletedGenerations > 0 ? "APPLIED" : "NOOP",
      retentionDeletedGenerations: applied.deletedGenerations,
      retentionDeletedListings: applied.deletedListingRows,
      retentionDurationMs: durationMs,
      retentionErrorCode: null
    };
  } catch (error) {
    return {
      retentionEnabled: true,
      retentionOutcome: "FAILED",
      retentionDeletedGenerations: 0,
      retentionDeletedListings: 0,
      retentionDurationMs: Math.max(0, performance.now() - startedAt),
      retentionErrorCode: safeRetentionErrorCode(error)
    };
  }
}

function recoveryError(code: string, message: string): never {
  throw new MercadoLivreProjectionJobRecoveryError(code, message);
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code).trim();
    if (code) return code.slice(0, 120);
  }
  return "PROJECTION_RECOVERY_FAILED";
}

function recoveryMetadata(input: Partial<MercadoLivreProjectionRecoveryMetadata> = {}) {
  return {
    recoveryGenerationId: input.recoveryGenerationId ?? null,
    recoveryDetected: input.recoveryDetected ?? false,
    recoveryAction: input.recoveryAction ?? "NORMAL_EXECUTION",
    previousGenerationStatus: input.previousGenerationStatus ?? null,
    syncOutcome: input.syncOutcome ?? "NORMAL_EXECUTION",
    workerLossCode: input.workerLossCode ?? null
  } satisfies MercadoLivreProjectionRecoveryMetadata;
}

function emitRecoveryTelemetry(input: {
  job: ReturnType<typeof normalizeMercadoLivreProjectionSyncJobData>;
  options: MercadoLivreProjectionSyncJobOptions | undefined;
  metadata: MercadoLivreProjectionRecoveryMetadata;
  status: "COMPLETE" | "ERROR";
  errorCode: string | null;
  total?: number | null;
  staged?: number;
}) {
  input.options?.onTelemetry?.({
    correlationId: input.job.correlationId,
    generationId: input.metadata.recoveryGenerationId,
    total: input.total ?? null,
    staged: input.staged ?? 0,
    catalogPages: 0,
    reconciliationPages: 0,
    batches: 0,
    maxConcurrency: 0,
    durationMs: 0,
    status: input.status,
    errorCode: input.errorCode,
    ...input.metadata
  });
}

export async function processMercadoLivreProjectionSyncJob(
  jobData: MercadoLivreProjectionSyncJobData,
  dependencies: {
    fullSyncService: FullSyncProcessor;
    retentionService?: RetentionProcessor;
    environment?: MercadoLivreProjectionRetentionEnvironment;
    options?: MercadoLivreProjectionSyncJobOptions & {
      recovery?: MercadoLivreProjectionRecoveryContext;
    };
  }
): Promise<MercadoLivreProjectionSyncJobResult> {
  const safeJob = normalizeMercadoLivreProjectionSyncJobData(jobData);
  const scope = {
    organizationId: safeJob.organizationId,
    marketplaceConnectionId: safeJob.marketplaceConnectionId,
    sellerId: safeJob.sellerId
  };
  const recovery = dependencies.options?.recovery;
  let metadata = recoveryMetadata(recovery ? {
    recoveryGenerationId: recovery.generationId,
    recoveryDetected: recovery.recoveryDetected
  } : undefined);
  let syncResult: MercadoLivreProjectionFullSyncResult | RecoveredCompleteSyncResult;

  if (recovery) {
    const inspect = dependencies.fullSyncService.inspectRecoveryGeneration;
    const abort = dependencies.fullSyncService.abortRecoveryGeneration;
    if (!inspect || !abort) {
      recoveryError(
        "PROJECTION_RECOVERY_NOT_CONFIGURED",
        "Projection job recovery is not configured."
      );
    }
    let previous: Awaited<ReturnType<typeof inspect>>;
    try {
      previous = await dependencies.fullSyncService.inspectRecoveryGeneration!({
        ...scope,
        generationId: recovery.generationId
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === "PROJECTION_RECOVERY_SCOPE_MISMATCH") {
        metadata = recoveryMetadata({
          ...metadata,
          recoveryAction: "RECOVERY_SCOPE_MISMATCH",
          syncOutcome: "RECOVERY_SCOPE_MISMATCH"
        });
        emitRecoveryTelemetry({
          job: safeJob,
          options: dependencies.options,
          metadata,
          status: "ERROR",
          errorCode: code
        });
      }
      throw error;
    }

    if (previous?.status === "BUILDING") {
      if (!recovery.recoveryDetected) {
        recoveryError(
          "PROJECTION_RECOVERY_SIGNAL_REQUIRED",
          "A building projection can only be recovered after a confirmed stalled replay."
        );
      }
      metadata = recoveryMetadata({
        ...metadata,
        recoveryAction: "RECOVERED_BUILDING_ABORTED",
        previousGenerationStatus: "BUILDING",
        syncOutcome: "RECOVERED_BUILDING_ABORTED",
        workerLossCode: "PROJECTION_STALLED_JOB_ABORTED"
      });
      await dependencies.fullSyncService.abortRecoveryGeneration!({
        ...scope,
        generationId: recovery.generationId,
        errorCode: "PROJECTION_STALLED_JOB_ABORTED",
        errorSummary: "Projection worker was lost while building this generation."
      });
      emitRecoveryTelemetry({
        job: safeJob,
        options: dependencies.options,
        metadata,
        status: "ERROR",
        errorCode: "PROJECTION_STALLED_JOB_ABORTED",
        total: previous.expectedTotal,
        staged: previous.storedTotal
      });
      recoveryError(
        "PROJECTION_STALLED_JOB_ABORTED",
        "Projection stalled replay aborted the interrupted generation."
      );
    }

    if (previous?.status === "ERROR") {
      metadata = recoveryMetadata({
        ...metadata,
        previousGenerationStatus: "ERROR"
      });
      emitRecoveryTelemetry({
        job: safeJob,
        options: dependencies.options,
        metadata,
        status: "ERROR",
        errorCode: "PROJECTION_RECOVERY_GENERATION_ERROR",
        total: previous.expectedTotal,
        staged: previous.storedTotal
      });
      recoveryError(
        "PROJECTION_RECOVERY_GENERATION_ERROR",
        "Projection recovery generation is already terminal with an error."
      );
    }

    if (previous?.status === "COMPLETE") {
      if (!recovery.recoveryDetected) {
        recoveryError(
          "PROJECTION_RECOVERY_SIGNAL_REQUIRED",
          "A completed projection can only be recovered after a confirmed stalled replay."
        );
      }
      metadata = recoveryMetadata({
        ...metadata,
        recoveryAction: "RECOVERED_ALREADY_COMPLETE",
        previousGenerationStatus: "COMPLETE",
        syncOutcome: "RECOVERED_ALREADY_COMPLETE"
      });
      syncResult = {
        status: "COMPLETE",
        generationId: previous.generationId,
        expectedTotal: previous.expectedTotal!,
        storedTotal: previous.storedTotal,
        durationMs: 0
      };
      emitRecoveryTelemetry({
        job: safeJob,
        options: dependencies.options,
        metadata,
        status: "COMPLETE",
        errorCode: null,
        total: previous.expectedTotal,
        staged: previous.storedTotal
      });
    } else {
      metadata = recoveryMetadata({
        ...metadata,
        recoveryAction: recovery.recoveryDetected
          ? "RECOVERED_BEFORE_BEGIN"
          : "NORMAL_EXECUTION",
        syncOutcome: recovery.recoveryDetected
          ? "RECOVERED_BEFORE_BEGIN"
          : "NORMAL_EXECUTION"
      });
      syncResult = await dependencies.fullSyncService.fullSync({
        ...scope,
        correlationId: safeJob.correlationId,
        recoveryGenerationId: recovery.generationId,
        signal: dependencies.options?.signal,
        budgetMs: dependencies.options?.budgetMs,
        onProgress: dependencies.options?.onProgress,
        onTelemetry: (telemetry) => dependencies.options?.onTelemetry?.({
          ...telemetry,
          ...metadata
        })
      });
    }
  } else {
    syncResult = await dependencies.fullSyncService.fullSync({
      ...scope,
      correlationId: safeJob.correlationId,
      signal: dependencies.options?.signal,
      budgetMs: dependencies.options?.budgetMs,
      onProgress: dependencies.options?.onProgress,
      onTelemetry: (telemetry) => dependencies.options?.onTelemetry?.({
        ...telemetry,
        ...metadata
      })
    });
  }
  const retention = await runPostSyncRetention({
    scope,
    environment: dependencies.environment ?? process.env,
    retentionService: dependencies.retentionService
      ?? mercadoLivreListingProjectionRetentionService
  });
  if (metadata.syncOutcome === "RECOVERED_ALREADY_COMPLETE") {
    if (retention.retentionOutcome === "APPLIED") {
      metadata = recoveryMetadata({
        ...metadata,
        syncOutcome: "RECOVERED_COMPLETE_RETENTION_APPLIED"
      });
    } else if (retention.retentionOutcome === "NOOP") {
      metadata = recoveryMetadata({
        ...metadata,
        syncOutcome: "RECOVERED_COMPLETE_RETENTION_NOOP"
      });
    }
  }
  return { ...syncResult, ...retention, ...metadata };
}
