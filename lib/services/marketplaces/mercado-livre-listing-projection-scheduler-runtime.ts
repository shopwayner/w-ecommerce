import { prisma } from "@/lib/prisma";
import { parseMercadoLivreProjectionRedisConnection } from "@/lib/services/marketplaces/mercado-livre-listing-projection-bullmq";
import {
  parseMercadoLivreProjectionSchedulerConfig,
  MercadoLivreProjectionSchedulerConfigurationError,
  type MercadoLivreProjectionSchedulerEnvironment
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-scheduler-config";
import {
  createMercadoLivreProjectionSchedulerQueue,
  createPrismaMercadoLivreProjectionSchedulerRepository,
  MercadoLivreProjectionScheduler,
  type MercadoLivreProjectionSchedulerDecision,
  type MercadoLivreProjectionSchedulerEvaluation,
  type MercadoLivreProjectionSchedulerQueue,
  type MercadoLivreProjectionSchedulerRepository
} from "@/lib/services/marketplaces/mercado-livre-listing-projection-scheduler";

type RuntimeSignal = "SIGINT" | "SIGTERM";

type RuntimeSignalSource = {
  once(signal: RuntimeSignal, listener: () => void): unknown;
  off(signal: RuntimeSignal, listener: () => void): unknown;
};

export type MercadoLivreProjectionSchedulerHealth = {
  running: boolean;
  lastTickAt: string | null;
  nextTickAt: string | null;
  configuredTargets: number;
  lastDecision: MercadoLivreProjectionSchedulerDecision | "NO_TARGETS" | null;
  lastEnqueueAt: string | null;
  error: string | null;
};

export type MercadoLivreProjectionSchedulerRuntimeEvent = {
  event:
    | "projection_scheduler_started"
    | "projection_scheduler_health"
    | "projection_scheduler_decision"
    | "projection_scheduler_stopping"
    | "projection_scheduler_stopped";
  [key: string]: string | number | boolean | null;
};

type RuntimeDependencies = {
  repository?: MercadoLivreProjectionSchedulerRepository;
  queue?: MercadoLivreProjectionSchedulerQueue;
  validateDatabase?: () => Promise<void>;
  disconnectDatabase?: () => Promise<void>;
  signalSource?: RuntimeSignalSource;
  log?: (event: MercadoLivreProjectionSchedulerRuntimeEvent) => void;
  now?: () => Date;
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>;
};

export type MercadoLivreProjectionSchedulerRuntime = {
  getHealth(): MercadoLivreProjectionSchedulerHealth;
  done: Promise<void>;
  close(reason?: RuntimeSignal | "RUNTIME_CLOSE"): Promise<void>;
};

function defaultLog(event: MercadoLivreProjectionSchedulerRuntimeEvent) {
  console.log(JSON.stringify(event));
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code)
      .toUpperCase()
      .replace(/[^A-Z0-9_:-]+/g, "_")
      .slice(0, 120) || "PROJECTION_SCHEDULER_ERROR";
  }
  return "PROJECTION_SCHEDULER_ERROR";
}

function defaultSleep(durationMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, durationMs);
    timer.unref?.();
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function validateDatabaseConnection() {
  await prisma.$queryRaw<Array<{ databaseReady: number }>>`
    SELECT 1::integer AS "databaseReady"
  `;
}

function decisionEvent(result: MercadoLivreProjectionSchedulerEvaluation) {
  return {
    event: "projection_scheduler_decision" as const,
    targetHash: result.targetHash,
    evaluatedAt: result.evaluatedAt,
    activeGenerationId: result.activeGenerationId,
    ageMs: result.ageMs,
    freshness: result.freshness,
    due: result.due,
    decision: result.decision,
    slot: result.slot,
    jobId: result.jobId
  };
}

export async function startMercadoLivreProjectionSchedulerRuntime(
  env: MercadoLivreProjectionSchedulerEnvironment = process.env,
  dependencies: RuntimeDependencies = {}
): Promise<MercadoLivreProjectionSchedulerRuntime> {
  const config = parseMercadoLivreProjectionSchedulerConfig(env);
  if (!config.enabled) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_SCHEDULER_DISABLED"
    );
  }
  if (!env.DATABASE_URL?.trim() && !dependencies.validateDatabase) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_DATABASE_NOT_CONFIGURED"
    );
  }
  if (!env.REDIS_URL?.trim() && !dependencies.queue) {
    throw new MercadoLivreProjectionSchedulerConfigurationError(
      "PROJECTION_REDIS_NOT_CONFIGURED"
    );
  }

  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? defaultLog;
  const queue = dependencies.queue ?? createMercadoLivreProjectionSchedulerQueue(
    parseMercadoLivreProjectionRedisConnection(env.REDIS_URL)
  );
  const repository = dependencies.repository
    ?? createPrismaMercadoLivreProjectionSchedulerRepository();
  const validateDatabase = dependencies.validateDatabase
    ?? validateDatabaseConnection;
  const disconnectDatabase = dependencies.disconnectDatabase
    ?? (() => prisma.$disconnect());
  const signalSource = dependencies.signalSource ?? process;
  const sleep = dependencies.sleep ?? defaultSleep;
  await validateDatabase();

  const health: MercadoLivreProjectionSchedulerHealth = {
    running: true,
    lastTickAt: null,
    nextTickAt: null,
    configuredTargets: config.targets.length,
    lastDecision: null,
    lastEnqueueAt: null,
    error: null
  };
  const scheduler = new MercadoLivreProjectionScheduler({
    config,
    repository,
    queue,
    now
  });
  const sleepController = new AbortController();
  let stopping = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  let closePromise: Promise<void> | null = null;

  const emitHealth = () => log({
    event: "projection_scheduler_health",
    ...health
  });

  const loop = async () => {
    while (!stopping) {
      const tickAt = now();
      health.lastTickAt = tickAt.toISOString();
      health.error = null;
      const results = await scheduler.tick();
      if (results.length === 0) health.lastDecision = "NO_TARGETS";
      for (const result of results) {
        health.lastDecision = result.decision;
        if (result.decision === "ERROR") {
          health.error = "PROJECTION_SCHEDULER_EVALUATION_FAILED";
        }
        if (result.decision === "ENQUEUED") {
          health.lastEnqueueAt = result.evaluatedAt;
        }
        log(decisionEvent(result));
      }
      if (stopping) break;
      health.nextTickAt = new Date(tickAt.getTime() + config.tickMs).toISOString();
      emitHealth();
      await sleep(config.tickMs, sleepController.signal);
    }
  };

  log({
    event: "projection_scheduler_started",
    running: true,
    configuredTargets: config.targets.length,
    tickMs: config.tickMs,
    cadenceMs: config.policy.cadenceMs,
    staleAfterMs: config.policy.staleAfterMs
  });
  const loopPromise = loop().catch((error) => {
    health.error = safeErrorCode(error);
    stopping = true;
  });

  const close = (reason: RuntimeSignal | "RUNTIME_CLOSE" = "RUNTIME_CLOSE") => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      signalSource.off("SIGTERM", onSigterm);
      signalSource.off("SIGINT", onSigint);
      stopping = true;
      sleepController.abort(reason);
      log({
        event: "projection_scheduler_stopping",
        reason,
        lastDecision: health.lastDecision
      });
      try {
        await loopPromise;
        await queue.close();
      } finally {
        await disconnectDatabase();
        health.running = false;
        health.nextTickAt = null;
        emitHealth();
        log({
          event: "projection_scheduler_stopped",
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
  void loopPromise.then(() => {
    if (health.error && !closePromise) void close("RUNTIME_CLOSE");
  });

  return {
    getHealth: () => ({ ...health }),
    done,
    close
  };
}

export async function runMercadoLivreProjectionSchedulerRuntime(
  env: MercadoLivreProjectionSchedulerEnvironment = process.env
) {
  const runtime = await startMercadoLivreProjectionSchedulerRuntime(env);
  await runtime.done;
}

export function sanitizeMercadoLivreProjectionSchedulerRuntimeError(error: unknown) {
  return {
    event: "projection_scheduler_fatal" as const,
    errorClass: error instanceof Error ? error.name.slice(0, 120) : "UnknownError",
    errorCode: safeErrorCode(error)
  };
}
