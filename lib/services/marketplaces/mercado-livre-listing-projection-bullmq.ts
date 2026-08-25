import { createHash } from "node:crypto";
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
  normalizeMercadoLivreProjectionSyncJobData,
  processMercadoLivreProjectionSyncJob,
  type MercadoLivreProjectionSyncJobData
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-sync-job";
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
  progress: MercadoLivreProjectionFullSyncProgress | null;
};

export type MercadoLivreProjectionWorkerTelemetry =
  MercadoLivreProjectionFullSyncTelemetry & {
    jobId: string;
    reason: MercadoLivreProjectionSyncJobData["reason"];
  };

export class MercadoLivreProjectionWorkerConfigurationError extends Error {
  constructor(readonly code: string) {
    super(`Mercado Livre projection worker configuration failed: ${code}`);
    this.name = "MercadoLivreProjectionWorkerConfigurationError";
  }
}

type ProjectionQueue = Queue<
  MercadoLivreProjectionSyncJobData,
  unknown,
  typeof MERCADO_LIVRE_PROJECTION_JOB_NAME
>;

let sharedQueue: ProjectionQueue | null = null;

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
  const rawUrl = env.REDIS_URL?.trim();
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
    progress: null
  };
  const sourceFactory = input.sourceFactory ?? (() => new MercadoLivreHttpProjectionSyncSource());
  const serviceFactory = input.serviceFactory
    ?? ((source) => new MercadoLivreListingProjectionFullSyncService({ source }));
  let activeController: AbortController | null = null;
  const worker = new Worker<
    MercadoLivreProjectionSyncJobData,
    unknown,
    typeof MERCADO_LIVRE_PROJECTION_JOB_NAME
  >(
    MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME,
    async (job: Job<MercadoLivreProjectionSyncJobData>) => {
      const safeData = normalizeMercadoLivreProjectionSyncJobData(job.data);
      const jobId = String(job.id ?? "unknown");
      const startedAt = performance.now();
      const controller = new AbortController();
      activeController = controller;
      health.activeJobId = jobId;
      health.progress = null;
      try {
        const result = await processMercadoLivreProjectionSyncJob(safeData, {
          fullSyncService: serviceFactory(sourceFactory(safeData)),
          options: {
            signal: controller.signal,
            onProgress: (progress) => {
              health.progress = progress;
            },
            onTelemetry: (telemetry) => {
              input.onTelemetry?.({
                ...telemetry,
                jobId,
                reason: safeData.reason
              });
            }
          }
        });
        health.lastOutcome = "COMPLETE";
        health.lastErrorCode = null;
        return result;
      } catch (error) {
        health.lastOutcome = "ERROR";
        health.lastErrorCode =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code).slice(0, 120)
            : "PROJECTION_WORKER_JOB_FAILED";
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
