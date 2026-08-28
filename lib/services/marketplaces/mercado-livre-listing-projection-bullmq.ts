import { createHash, randomUUID } from "node:crypto";
import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job
} from "bullmq";
import {
  MercadoLivreListingProjectionFullSyncService,
  type MercadoLivreProjectionFullSyncProgress,
  type MercadoLivreProjectionFullSyncTelemetry
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-full-sync-service";
import { MercadoLivreHttpProjectionSyncSource } from "@/lib/services/marketplaces/mercado-livre-listing-projection-http-source";
import {
  MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME,
  MercadoLivreProjectionJobRecoveryError,
  normalizeMercadoLivreProjectionSyncJobData,
  processMercadoLivreProjectionSyncJob,
  type MercadoLivreProjectionRetentionOutcome,
  type MercadoLivreProjectionRetentionTelemetry,
  type MercadoLivreProjectionSyncJobData
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-sync-job";
import {
  isMercadoLivreProjectionRetentionEnabled
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-retention-config";
import type {
  MercadoLivreListingProjectionRetentionService
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-retention-service";
import type { MercadoLivreProjectionSyncSource } from "@/lib/services/marketplaces/mercado-livre-listing-projection-source";

export const MERCADO_LIVRE_PROJECTION_WORKER_FLAG =
  "MERCADO_LIVRE_PROJECTION_WORKER_ENABLED";
export const MERCADO_LIVRE_PROJECTION_JOB_NAME = "full-sync";

export type MercadoLivreProjectionWorkerEnvironment = {
  [key: string]: string | undefined;
  MERCADO_LIVRE_PROJECTION_WORKER_ENABLED?: string;
  REDIS_URL?: string;
};

export type MercadoLivreProjectionWorkerHealth = {
  running: boolean;
  activeJobId: string | null;
  lastJobId: string | null;
  lastOutcome: "COMPLETE" | "ERROR" | null;
  lastDurationMs: number | null;
  lastErrorCode: string | null;
  lastRetentionOutcome: MercadoLivreProjectionRetentionOutcome | null;
  lastRetentionErrorCode: string | null;
  progress: MercadoLivreProjectionFullSyncProgress | null;
};

export type MercadoLivreProjectionWorkerTelemetry =
  MercadoLivreProjectionFullSyncTelemetry & {
    jobId: string;
    reason: MercadoLivreProjectionSyncJobData["reason"];
  } & MercadoLivreProjectionRetentionTelemetry;

export class MercadoLivreProjectionWorkerConfigurationError extends Error {
  constructor(readonly code: string) {
    super(`Mercado Livre projection worker configuration failed: ${code}`);
    this.name = "MercadoLivreProjectionWorkerConfigurationError";
  }
}

export type ProjectionQueue = Queue<
  MercadoLivreProjectionSyncJobData,
  unknown,
  typeof MERCADO_LIVRE_PROJECTION_JOB_NAME
>;

let sharedQueue: ProjectionQueue | null = null;

const RECOVERY_GENERATION_ID_PATTERN = /^mlpr_[a-f0-9]{32}$/;

export type MercadoLivreProjectionPersistedJobData =
  ReturnType<typeof normalizeMercadoLivreProjectionSyncJobData> & {
    recoveryGenerationId?: string;
  };

export function createMercadoLivreProjectionRecoveryGenerationId() {
  return `mlpr_${randomUUID().replaceAll("-", "")}`;
}

export function normalizeMercadoLivreProjectionPersistedJobData(
  input: unknown
): MercadoLivreProjectionPersistedJobData {
  const publicData = normalizeMercadoLivreProjectionSyncJobData(
    input as MercadoLivreProjectionSyncJobData
  );
  const recoveryGenerationId = input && typeof input === "object"
    ? (input as { recoveryGenerationId?: unknown }).recoveryGenerationId
    : undefined;
  if (recoveryGenerationId === undefined) return publicData;
  if (
    typeof recoveryGenerationId !== "string"
    || !RECOVERY_GENERATION_ID_PATTERN.test(recoveryGenerationId)
  ) {
    throw new MercadoLivreProjectionJobRecoveryError(
      "PROJECTION_RECOVERY_ID_INVALID",
      "Projection recovery generation ID is invalid."
    );
  }
  return { ...publicData, recoveryGenerationId };
}

export function mercadoLivreProjectionStalledRecoverySignal(input: {
  stalledCounter: number;
  attemptsStarted: number;
  attemptsMade: number;
}) {
  for (const value of [input.stalledCounter, input.attemptsStarted, input.attemptsMade]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MercadoLivreProjectionJobRecoveryError(
        "PROJECTION_RECOVERY_SIGNAL_INVALID",
        "Projection recovery signal is invalid."
      );
    }
  }
  if (input.stalledCounter === 0) return false;
  if (input.attemptsStarted > 1) return true;
  throw new MercadoLivreProjectionJobRecoveryError(
    "PROJECTION_RECOVERY_SIGNAL_INVALID",
    "Projection stalled signal is inconsistent."
  );
}

export async function prepareMercadoLivreProjectionJobRecovery(input: {
  jobData: unknown;
  stalledCounter: number;
  attemptsStarted: number;
  attemptsMade: number;
  validateScope: (
    scope: ReturnType<typeof normalizeMercadoLivreProjectionSyncJobData>
  ) => Promise<unknown>;
  updateData: (data: MercadoLivreProjectionPersistedJobData) => Promise<unknown>;
  createRecoveryGenerationId?: () => string;
}) {
  const safeData = normalizeMercadoLivreProjectionSyncJobData(
    input.jobData as MercadoLivreProjectionSyncJobData
  );
  await input.validateScope(safeData);
  const persistedData = normalizeMercadoLivreProjectionPersistedJobData(input.jobData);
  let recoveryGenerationId = persistedData.recoveryGenerationId;
  if (!recoveryGenerationId) {
    recoveryGenerationId = (
      input.createRecoveryGenerationId
      ?? createMercadoLivreProjectionRecoveryGenerationId
    )();
    if (!RECOVERY_GENERATION_ID_PATTERN.test(recoveryGenerationId)) {
      throw new MercadoLivreProjectionJobRecoveryError(
        "PROJECTION_RECOVERY_ID_INVALID",
        "Projection recovery generation ID is invalid."
      );
    }
    await input.updateData({ ...safeData, recoveryGenerationId });
  }
  return {
    safeData,
    recovery: {
      generationId: recoveryGenerationId,
      recoveryDetected: mercadoLivreProjectionStalledRecoverySignal({
        stalledCounter: input.stalledCounter,
        attemptsStarted: input.attemptsStarted,
        attemptsMade: input.attemptsMade
      }),
      stalledCounter: input.stalledCounter,
      attemptsStarted: input.attemptsStarted,
      attemptsMade: input.attemptsMade
    }
  };
}

export function isMercadoLivreProjectionWorkerEnabled(
  env: MercadoLivreProjectionWorkerEnvironment = process.env
) {
  return env.MERCADO_LIVRE_PROJECTION_WORKER_ENABLED === "true";
}

function requireEnabled(env: MercadoLivreProjectionWorkerEnvironment) {
  if (!isMercadoLivreProjectionWorkerEnabled(env)) {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_WORKER_DISABLED"
    );
  }
}

export function mercadoLivreProjectionRedisConnection(
  env: MercadoLivreProjectionWorkerEnvironment = process.env
): ConnectionOptions {
  requireEnabled(env);
  return parseMercadoLivreProjectionRedisConnection(env.REDIS_URL);
}

export function parseMercadoLivreProjectionRedisConnection(
  rawRedisUrl: string | undefined
): ConnectionOptions {
  const rawUrl = rawRedisUrl?.trim();
  if (!rawUrl) {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_REDIS_NOT_CONFIGURED"
    );
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_REDIS_URL_INVALID"
    );
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_REDIS_URL_INVALID"
    );
  }
  const databaseText = url.pathname.replace(/^\//, "");
  const database = databaseText ? Number(databaseText) : 0;
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_REDIS_URL_INVALID"
    );
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null
  };
}

export function createMercadoLivreProjectionQueue(input: {
  env?: MercadoLivreProjectionWorkerEnvironment;
  connection?: ConnectionOptions;
} = {}): ProjectionQueue {
  const env = input.env ?? process.env;
  requireEnabled(env);
  return new Queue(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: input.connection ?? mercadoLivreProjectionRedisConnection(env),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 }
    }
  });
}

export function createMercadoLivreProjectionQueueWithConnection(
  connection: ConnectionOptions
): ProjectionQueue {
  return new Queue(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 }
    }
  });
}

export function getMercadoLivreProjectionQueue(input: {
  env?: MercadoLivreProjectionWorkerEnvironment;
  connection?: ConnectionOptions;
} = {}) {
  const env = input.env ?? process.env;
  requireEnabled(env);
  if (!sharedQueue) {
    sharedQueue = createMercadoLivreProjectionQueue({
      env,
      connection: input.connection
    });
  }
  return sharedQueue;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function enqueueMercadoLivreProjectionFullSync(
  data: MercadoLivreProjectionSyncJobData,
  options: {
    env?: MercadoLivreProjectionWorkerEnvironment;
    queue?: ProjectionQueue;
  } = {}
) {
  const env = options.env ?? process.env;
  requireEnabled(env);
  const safeData = normalizeMercadoLivreProjectionSyncJobData(data);
  const scopeDigest = digest([
    safeData.organizationId,
    safeData.marketplaceConnectionId,
    safeData.sellerId
  ].join("\n"));
  const jobDigest = digest(`${scopeDigest}\n${safeData.correlationId}`);
  const queue = options.queue ?? getMercadoLivreProjectionQueue({ env });
  return queue.add(MERCADO_LIVRE_PROJECTION_JOB_NAME, safeData, {
    jobId: `ml-projection-${jobDigest}`,
    attempts: 1,
    deduplication: { id: `ml-projection-${scopeDigest}` }
  });
}

export async function enqueueScheduledMercadoLivreProjectionFullSync(
  data: MercadoLivreProjectionSyncJobData,
  input: {
    slot: number;
    queue: ProjectionQueue;
  }
) {
  if (!Number.isSafeInteger(input.slot) || input.slot < 0) {
    throw new Error("Invalid Mercado Livre projection scheduler slot.");
  }
  const safeData = normalizeMercadoLivreProjectionSyncJobData(data);
  if (safeData.reason !== "PERIODIC_RECONCILIATION") {
    throw new Error("Scheduled Mercado Livre projection jobs require PERIODIC_RECONCILIATION.");
  }
  const slotDigest = digest([
    safeData.organizationId,
    safeData.marketplaceConnectionId,
    safeData.sellerId,
    String(input.slot)
  ].join("\n"));
  const identity = `ml-projection-scheduled-${slotDigest}`;
  return input.queue.add(MERCADO_LIVRE_PROJECTION_JOB_NAME, safeData, {
    jobId: identity,
    attempts: 1,
    deduplication: { id: identity }
  });
}

export async function hasPendingMercadoLivreProjectionJob(
  queue: ProjectionQueue,
  target: Pick<
    MercadoLivreProjectionSyncJobData,
    "organizationId" | "marketplaceConnectionId" | "sellerId"
  >
) {
  const jobs = await queue.getJobs(["waiting", "active", "delayed"], 0, -1, true);
  return jobs.some((job) => {
    try {
      const data = normalizeMercadoLivreProjectionSyncJobData(job.data);
      return data.organizationId === target.organizationId
        && data.marketplaceConnectionId === target.marketplaceConnectionId
        && data.sellerId === target.sellerId;
    } catch {
      return false;
    }
  });
}

export async function closeSharedMercadoLivreProjectionQueue() {
  const queue = sharedQueue;
  sharedQueue = null;
  await queue?.close();
}

export function createMercadoLivreProjectionWorker(input: {
  env?: MercadoLivreProjectionWorkerEnvironment;
  connection?: ConnectionOptions;
  sourceFactory?: (
    jobData: MercadoLivreProjectionSyncJobData
  ) => MercadoLivreProjectionSyncSource;
  serviceFactory?: (
    source: MercadoLivreProjectionSyncSource
  ) => MercadoLivreListingProjectionFullSyncService;
  createRecoveryGenerationId?: () => string;
  authorizeJob?: (
    jobData: MercadoLivreProjectionSyncJobData
  ) => Promise<void> | void;
  retentionService?: Pick<
    MercadoLivreListingProjectionRetentionService,
    "planRetention" | "applyRetention"
  >;
  onTelemetry?: (event: MercadoLivreProjectionWorkerTelemetry) => void;
}) {
  const env = input.env ?? process.env;
  requireEnabled(env);
  const health: MercadoLivreProjectionWorkerHealth = {
    running: true,
    activeJobId: null,
    lastJobId: null,
    lastOutcome: null,
    lastDurationMs: null,
    lastErrorCode: null,
    lastRetentionOutcome: null,
    lastRetentionErrorCode: null,
    progress: null
  };
  const sourceFactory = input.sourceFactory ?? (() => new MercadoLivreHttpProjectionSyncSource());
  const serviceFactory = input.serviceFactory
    ?? ((source) => new MercadoLivreListingProjectionFullSyncService({ source }));
  const createRecoveryGenerationId = input.createRecoveryGenerationId
    ?? createMercadoLivreProjectionRecoveryGenerationId;
  let activeController: AbortController | null = null;
  const worker = new Worker<
    MercadoLivreProjectionPersistedJobData,
    unknown,
    typeof MERCADO_LIVRE_PROJECTION_JOB_NAME
  >(
    MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME,
    async (job: Job<MercadoLivreProjectionPersistedJobData>) => {
      const publicJobData = normalizeMercadoLivreProjectionSyncJobData(job.data);
      await input.authorizeJob?.(publicJobData);
      const jobId = String(job.id ?? "unknown");
      const startedAt = performance.now();
      const controller = new AbortController();
      activeController = controller;
      health.activeJobId = jobId;
      health.progress = null;
      const telemetryState: {
        latest: MercadoLivreProjectionFullSyncTelemetry | null;
      } = { latest: null };
      try {
        const fullSyncService = serviceFactory(sourceFactory(publicJobData));
        const prepared = await prepareMercadoLivreProjectionJobRecovery({
          jobData: job.data,
          stalledCounter: job.stalledCounter,
          attemptsStarted: job.attemptsStarted,
          attemptsMade: job.attemptsMade,
          validateScope: (scope) => fullSyncService.validateScope(scope),
          updateData: (data) => job.updateData(data),
          createRecoveryGenerationId
        });
        const safeData = prepared.safeData;
        const result = await processMercadoLivreProjectionSyncJob(safeData, {
          fullSyncService,
          retentionService: input.retentionService,
          environment: env,
          options: {
            recovery: prepared.recovery,
            signal: controller.signal,
            onProgress: (progress) => {
              health.progress = progress;
            },
            onTelemetry: (telemetry) => {
              telemetryState.latest = telemetry;
            }
          }
        });
        health.lastOutcome = "COMPLETE";
        health.lastErrorCode = null;
        health.lastRetentionOutcome = result.retentionOutcome;
        health.lastRetentionErrorCode = result.retentionErrorCode;
        if (telemetryState.latest) {
          input.onTelemetry?.({
            ...telemetryState.latest,
            recoveryGenerationId: result.recoveryGenerationId,
            recoveryDetected: result.recoveryDetected,
            recoveryAction: result.recoveryAction,
            previousGenerationStatus: result.previousGenerationStatus,
            syncOutcome: result.syncOutcome,
            workerLossCode: result.workerLossCode,
            jobId,
            reason: publicJobData.reason,
            retentionEnabled: result.retentionEnabled,
            retentionOutcome: result.retentionOutcome,
            retentionDeletedGenerations: result.retentionDeletedGenerations,
            retentionDeletedListings: result.retentionDeletedListings,
            retentionDurationMs: result.retentionDurationMs,
            retentionErrorCode: result.retentionErrorCode
          });
        }
        return result;
      } catch (error) {
        health.lastOutcome = "ERROR";
        health.lastErrorCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code).slice(0, 120)
            : "PROJECTION_WORKER_JOB_FAILED";
        health.lastRetentionOutcome = "NOT_RUN_SYNC_FAILED";
        health.lastRetentionErrorCode = null;
        if (telemetryState.latest) {
          input.onTelemetry?.({
            ...telemetryState.latest,
            jobId,
            reason: publicJobData.reason,
            retentionEnabled: isMercadoLivreProjectionRetentionEnabled(env),
            retentionOutcome: "NOT_RUN_SYNC_FAILED",
            retentionDeletedGenerations: 0,
            retentionDeletedListings: 0,
            retentionDurationMs: 0,
            retentionErrorCode: null
          });
        }
        throw error;
      } finally {
        if (activeController === controller) activeController = null;
        health.activeJobId = null;
        health.lastJobId = jobId;
        health.lastDurationMs = Math.max(0, performance.now() - startedAt);
      }
    },
    {
      connection: input.connection ?? mercadoLivreProjectionRedisConnection(env),
      concurrency: 1
    }
  );

  return {
    worker,
    getHealth: () => ({ ...health }),
    async close() {
      activeController?.abort("PROJECTION_WORKER_SHUTDOWN");
      await worker.close();
      health.running = false;
      health.activeJobId = null;
    }
  };
}
