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

type FullSyncProcessor = Pick<MercadoLivreListingProjectionFullSyncService, "fullSync">;
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

export type MercadoLivreProjectionSyncJobResult =
  MercadoLivreProjectionFullSyncResult & MercadoLivreProjectionRetentionTelemetry;

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

export async function processMercadoLivreProjectionSyncJob(
  jobData: MercadoLivreProjectionSyncJobData,
  dependencies: {
    fullSyncService: FullSyncProcessor;
    retentionService?: RetentionProcessor;
    environment?: MercadoLivreProjectionRetentionEnvironment;
    options?: MercadoLivreProjectionSyncJobOptions;
  }
): Promise<MercadoLivreProjectionSyncJobResult> {
  const safeJob = normalizeMercadoLivreProjectionSyncJobData(jobData);
  const syncResult = await dependencies.fullSyncService.fullSync({
    organizationId: safeJob.organizationId,
    marketplaceConnectionId: safeJob.marketplaceConnectionId,
    sellerId: safeJob.sellerId,
    correlationId: safeJob.correlationId,
    signal: dependencies.options?.signal,
    budgetMs: dependencies.options?.budgetMs,
    onProgress: dependencies.options?.onProgress,
    onTelemetry: dependencies.options?.onTelemetry
  });
  const retention = await runPostSyncRetention({
    scope: {
      organizationId: safeJob.organizationId,
      marketplaceConnectionId: safeJob.marketplaceConnectionId,
      sellerId: safeJob.sellerId
    },
    environment: dependencies.environment ?? process.env,
    retentionService: dependencies.retentionService
      ?? mercadoLivreListingProjectionRetentionService
  });
  return { ...syncResult, ...retention };
}
