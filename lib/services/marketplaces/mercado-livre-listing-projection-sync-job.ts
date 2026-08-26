import type {
  MercadoLivreListingProjectionFullSyncService,
  MercadoLivreProjectionFullSyncProgress,
  MercadoLivreProjectionFullSyncResult,
  MercadoLivreProjectionFullSyncTelemetry
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-full-sync-service";

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

function requiredJobText(value: unknown, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 191) {
    throw new Error(`Invalid Mercado Livre projection job ${field}.`);
  }
  return normalized;
}

function normalizedJobData(input: MercadoLivreProjectionSyncJobData) {
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

export async function processMercadoLivreProjectionSyncJob(
  jobData: MercadoLivreProjectionSyncJobData,
  dependencies: {
    fullSyncService: FullSyncProcessor;
    options?: MercadoLivreProjectionSyncJobOptions;
  }
): Promise<MercadoLivreProjectionFullSyncResult> {
  const safeJob = normalizedJobData(jobData);
  return dependencies.fullSyncService.fullSync({
    organizationId: safeJob.organizationId,
    marketplaceConnectionId: safeJob.marketplaceConnectionId,
    sellerId: safeJob.sellerId,
    correlationId: safeJob.correlationId,
    signal: dependencies.options?.signal,
    budgetMs: dependencies.options?.budgetMs,
    onProgress: dependencies.options?.onProgress,
    onTelemetry: dependencies.options?.onTelemetry
  });
}
