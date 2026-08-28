import { prisma } from "@/lib/prisma";
import {
  createMercadoLivreProjectionWorker,
  isMercadoLivreProjectionWorkerEnabled,
  mercadoLivreProjectionRedisConnection,
  MercadoLivreProjectionWorkerConfigurationError,
  type MercadoLivreProjectionWorkerEnvironment,
  type MercadoLivreProjectionWorkerHealth,
  type MercadoLivreProjectionWorkerTelemetry
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-bullmq";
import {
  MercadoLivreHttpProjectionSyncSource,
  mercadoLivreProjectionAccessTokenProvider,
  type MercadoLivreProjectionAccessTokenProvider
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-http-source";
import type { MercadoLivreProjectionSyncJobData } from "@/lib/services/marketplaces/mercado-livre-listing-projection-sync-job";
import type { MercadoLivreProjectionSyncSource } from "@/lib/services/marketplaces/mercado-livre-listing-projection-source";
import {
  assertMercadoLivreProjectionWorkerTargetAllowlisted,
  parseMercadoLivreProjectionRuntimeConfig,
  type MercadoLivreProjectionRuntimeEnvironment
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-runtime-config";
import {
  createMercadoLivreProjectionRuntimeHeartbeat
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-runtime-health";

const HEALTH_POLL_INTERVAL_MS = 1_000;

type ProjectionWorkerController = ReturnType<
  typeof createMercadoLivreProjectionWorker
>;

type RuntimeSignal = "SIGINT" | "SIGTERM";

type RuntimeEnvironment = MercadoLivreProjectionWorkerEnvironment &
  MercadoLivreProjectionRuntimeEnvironment & {
  DATABASE_URL?: string;
};

type RuntimeSignalSource = {
  once(signal: RuntimeSignal, listener: () => void): unknown;
  off(signal: RuntimeSignal, listener: () => void): unknown;
};

export type MercadoLivreProjectionWorkerRuntimeEvent = {
  event:
    | "projection_worker_started"
    | "projection_worker_health"
    | "projection_worker_job_active"
    | "projection_worker_job_completed"
    | "projection_worker_job_failed"
    | "projection_worker_telemetry"
    | "projection_worker_retention_warning"
    | "projection_worker_http_telemetry"
    | "projection_worker_heartbeat_error"
    | "projection_worker_error"
    | "projection_worker_stopping"
    | "projection_worker_stopped";
  [key: string]: string | number | boolean | null | object;
};

type ProjectionWorkerHttpTelemetry = {
  logicalGets: number;
  networkGets: number;
  status401: number;
  status429: number;
  status5xx: number;
  timeouts: number;
  oauthRefreshes: number;
};

type RuntimeDependencies = {
  createWorker?: typeof createMercadoLivreProjectionWorker;
  validateDatabase?: () => Promise<void>;
  disconnectDatabase?: () => Promise<void>;
  signalSource?: RuntimeSignalSource;
  log?: (event: MercadoLivreProjectionWorkerRuntimeEvent) => void;
  healthPollIntervalMs?: number;
  heartbeat?: {
    starting(): Promise<unknown>;
    ready(busy?: boolean): Promise<unknown>;
    stopped(): Promise<unknown>;
  };
};

export type MercadoLivreProjectionWorkerRuntime = {
  getHealth(): MercadoLivreProjectionWorkerHealth;
  done: Promise<void>;
  close(reason?: RuntimeSignal | "RUNTIME_CLOSE"): Promise<void>;
};

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const value = String((error as { code: unknown }).code).trim();
    return value ? value.slice(0, 120) : "PROJECTION_WORKER_ERROR";
  }
  return "PROJECTION_WORKER_ERROR";
}

function safeJobId(value: unknown) {
  const normalized = String(value ?? "unknown").trim();
  return normalized.slice(0, 191) || "unknown";
}

function healthEvent(health: MercadoLivreProjectionWorkerHealth) {
  return {
    event: "projection_worker_health" as const,
    running: health.running,
    activeJobId: health.activeJobId,
    lastJobId: health.lastJobId,
    lastOutcome: health.lastOutcome,
    lastDurationMs: health.lastDurationMs,
    lastErrorCode: health.lastErrorCode,
    lastRetentionOutcome: health.lastRetentionOutcome,
    lastRetentionErrorCode: health.lastRetentionErrorCode,
    progress: health.progress
  };
}

function telemetryEvent(telemetry: MercadoLivreProjectionWorkerTelemetry) {
  return {
    event: "projection_worker_telemetry" as const,
    jobId: telemetry.jobId,
    correlationId: telemetry.correlationId,
    generationId: telemetry.generationId,
    reason: telemetry.reason,
    total: telemetry.total,
    staged: telemetry.staged,
    catalogPages: telemetry.catalogPages,
    reconciliationPages: telemetry.reconciliationPages,
    batches: telemetry.batches,
    maxConcurrency: telemetry.maxConcurrency,
    durationMs: telemetry.durationMs,
    status: telemetry.status,
    errorCode: telemetry.errorCode,
    recoveryGenerationId: telemetry.recoveryGenerationId ?? null,
    recoveryDetected: telemetry.recoveryDetected ?? false,
    recoveryAction: telemetry.recoveryAction ?? "NORMAL_EXECUTION",
    previousGenerationStatus: telemetry.previousGenerationStatus ?? null,
    syncOutcome: telemetry.syncOutcome ?? "NORMAL_EXECUTION",
    workerLossCode: telemetry.workerLossCode ?? null,
    retentionEnabled: telemetry.retentionEnabled,
    retentionOutcome: telemetry.retentionOutcome,
    retentionDeletedGenerations: telemetry.retentionDeletedGenerations,
    retentionDeletedListings: telemetry.retentionDeletedListings,
    retentionDurationMs: telemetry.retentionDurationMs,
    retentionErrorCode: telemetry.retentionErrorCode
  };
}

function defaultLog(event: MercadoLivreProjectionWorkerRuntimeEvent) {
  console.log(JSON.stringify(event));
}

function createObservedHttpSource() {
  const telemetry: ProjectionWorkerHttpTelemetry = {
    logicalGets: 0,
    networkGets: 0,
    status401: 0,
    status429: 0,
    status5xx: 0,
    timeouts: 0,
    oauthRefreshes: 0
  };
  const fetchImpl: typeof fetch = async (request, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      telemetry.networkGets += 1;
    }
    try {
      const response = await fetch(request, init);
      if (response.status === 401) telemetry.status401 += 1;
      if (response.status === 429) telemetry.status429 += 1;
      if (response.status >= 500) telemetry.status5xx += 1;
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        telemetry.timeouts += 1;
      }
      throw error;
    }
  };
  const tokenProvider: MercadoLivreProjectionAccessTokenProvider = {
    getAccessToken: (input) => mercadoLivreProjectionAccessTokenProvider.getAccessToken(input),
    refreshAccessToken: async (input) => {
      telemetry.oauthRefreshes += 1;
      return mercadoLivreProjectionAccessTokenProvider.refreshAccessToken(input);
    }
  };
  const httpSource = new MercadoLivreHttpProjectionSyncSource({ fetchImpl, tokenProvider });
  const source: MercadoLivreProjectionSyncSource = {
    resolveIdentity(input) {
      telemetry.logicalGets += 1;
      return httpSource.resolveIdentity(input);
    },
    getCatalogMetadata(input) {
      telemetry.logicalGets += 1;
      return httpSource.getCatalogMetadata(input);
    },
    listCatalogPage(input) {
      telemetry.logicalGets += 1;
      return httpSource.listCatalogPage(input);
    },
    getListingDetails(input) {
      telemetry.logicalGets += 1;
      return httpSource.getListingDetails(input);
    }
  };
  return {
    source,
    telemetry
  };
}

function httpTelemetryEvent(input: {
  jobId: string;
  correlationId: string;
  telemetry: ProjectionWorkerHttpTelemetry;
}) {
  return {
    event: "projection_worker_http_telemetry" as const,
    jobId: input.jobId,
    correlationId: input.correlationId,
    ...input.telemetry,
    retries: Math.max(
      0,
      input.telemetry.networkGets - input.telemetry.logicalGets
    )
  };
}

async function validateDatabaseConnection() {
  await prisma.$queryRaw<Array<{ databaseReady: number }>>`
    SELECT 1::integer AS "databaseReady"
  `;
}

export async function startMercadoLivreProjectionWorkerRuntime(
  env: RuntimeEnvironment = process.env,
  dependencies: RuntimeDependencies = {}
): Promise<MercadoLivreProjectionWorkerRuntime> {
  const runtimeConfig = parseMercadoLivreProjectionRuntimeConfig(env);
  if (!runtimeConfig.workerEnabled || !isMercadoLivreProjectionWorkerEnabled(env)) {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_WORKER_DISABLED"
    );
  }
  if (!env.DATABASE_URL?.trim() && !dependencies.validateDatabase) {
    throw new MercadoLivreProjectionWorkerConfigurationError(
      "PROJECTION_DATABASE_NOT_CONFIGURED"
    );
  }

  const connection = mercadoLivreProjectionRedisConnection(env);
  const log = dependencies.log ?? defaultLog;
  const validateDatabase = dependencies.validateDatabase
    ?? validateDatabaseConnection;
  const disconnectDatabase = dependencies.disconnectDatabase
    ?? (() => prisma.$disconnect());
  const signalSource = dependencies.signalSource ?? process;
  const createWorker = dependencies.createWorker
    ?? createMercadoLivreProjectionWorker;
  const heartbeat = dependencies.heartbeat
    ?? createMercadoLivreProjectionRuntimeHeartbeat({
      service: "worker",
      filePath: env.MERCADO_LIVRE_PROJECTION_HEALTH_FILE,
      targetCount: runtimeConfig.targets.length
    });

  await heartbeat.starting();
  await validateDatabase();

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let closePromise: Promise<void> | null = null;
  let lastHealthSignature = "";
  const httpTelemetryByCorrelation = new Map<
    string,
    ProjectionWorkerHttpTelemetry
  >();

  const controller: ProjectionWorkerController = createWorker({
    env,
    connection,
    authorizeJob(jobData) {
      assertMercadoLivreProjectionWorkerTargetAllowlisted(
        jobData,
        runtimeConfig.targets
      );
    },
    sourceFactory(jobData: MercadoLivreProjectionSyncJobData) {
      const observed = createObservedHttpSource();
      httpTelemetryByCorrelation.set(jobData.correlationId, observed.telemetry);
      return observed.source;
    },
    onTelemetry(telemetry) {
      log(telemetryEvent(telemetry));
      if (telemetry.retentionOutcome === "FAILED") {
        log({
          event: "projection_worker_retention_warning",
          jobId: telemetry.jobId,
          correlationId: telemetry.correlationId,
          generationId: telemetry.generationId,
          retentionOutcome: telemetry.retentionOutcome,
          retentionDurationMs: telemetry.retentionDurationMs,
          retentionErrorCode: telemetry.retentionErrorCode
        });
      }
      const httpTelemetry = httpTelemetryByCorrelation.get(telemetry.correlationId);
      if (httpTelemetry) {
        log(httpTelemetryEvent({
          jobId: telemetry.jobId,
          correlationId: telemetry.correlationId,
          telemetry: httpTelemetry
        }));
        httpTelemetryByCorrelation.delete(telemetry.correlationId);
      }
    }
  });

  controller.worker.on("active", (job) => {
    log({
      event: "projection_worker_job_active",
      jobId: safeJobId(job.id)
    });
  });
  controller.worker.on("completed", (job) => {
    log({
      event: "projection_worker_job_completed",
      jobId: safeJobId(job.id)
    });
  });
  controller.worker.on("failed", (job, error) => {
    log({
      event: "projection_worker_job_failed",
      jobId: safeJobId(job?.id),
      errorCode: safeErrorCode(error)
    });
  });
  controller.worker.on("error", (error) => {
    log({
      event: "projection_worker_error",
      errorCode: safeErrorCode(error),
      errorClass: error.name.slice(0, 120)
    });
  });

  try {
    await controller.worker.waitUntilReady();
    await heartbeat.ready(false);
  } catch (error) {
    await controller.close().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
    throw error;
  }
  log({
    event: "projection_worker_started",
    running: true,
    concurrency: 1
  });

  const emitHealth = () => {
    const health = controller.getHealth();
    void heartbeat.ready(Boolean(health.activeJobId)).catch((error) => {
      log({
        event: "projection_worker_heartbeat_error",
        errorCode: safeErrorCode(error)
      });
    });
    const signature = JSON.stringify(health);
    if (signature === lastHealthSignature) return;
    lastHealthSignature = signature;
    log(healthEvent(health));
  };
  emitHealth();
  const healthTimer = setInterval(
    emitHealth,
    Math.max(100, dependencies.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS)
  );
  healthTimer.unref?.();

  const close = (reason: RuntimeSignal | "RUNTIME_CLOSE" = "RUNTIME_CLOSE") => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      signalSource.off("SIGTERM", onSigterm);
      signalSource.off("SIGINT", onSigint);
      clearInterval(healthTimer);
      log({
        event: "projection_worker_stopping",
        reason,
        activeJobId: controller.getHealth().activeJobId
      });
      try {
        await controller.close();
      } finally {
        await disconnectDatabase();
        await heartbeat.stopped().catch(() => undefined);
        log({
          event: "projection_worker_stopped",
          reason,
          running: false
        });
        resolveDone();
      }
    })();
    return closePromise;
  };
  const onSigterm = () => void close("SIGTERM");
  const onSigint = () => void close("SIGINT");
  signalSource.once("SIGTERM", onSigterm);
  signalSource.once("SIGINT", onSigint);

  return {
    getHealth: controller.getHealth,
    done,
    close
  };
}

export async function runMercadoLivreProjectionWorkerRuntime(
  env: RuntimeEnvironment = process.env
) {
  const runtime = await startMercadoLivreProjectionWorkerRuntime(env);
  await runtime.done;
}

export function sanitizeMercadoLivreProjectionWorkerRuntimeError(error: unknown) {
  return {
    event: "projection_worker_fatal" as const,
    errorClass: error instanceof Error
      ? error.name.slice(0, 120)
      : "UnknownError",
    errorCode: safeErrorCode(error)
  };
}
