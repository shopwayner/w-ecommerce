import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createMercadoLivreProjectionWorker,
  MercadoLivreProjectionWorkerConfigurationError,
  type MercadoLivreProjectionWorkerHealth
} from "./mercado-livre-listing-projection-bullmq";
import {
  sanitizeMercadoLivreProjectionWorkerRuntimeError,
  startMercadoLivreProjectionWorkerRuntime,
  type MercadoLivreProjectionWorkerRuntimeEvent
} from "./mercado-livre-listing-projection-worker-runtime";

const enabledEnvironment = {
  MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
  REDIS_URL: "redis://localhost:6379/0"
};

function fakeController(input: {
  health?: Partial<MercadoLivreProjectionWorkerHealth>;
  onClose?: () => void;
} = {}) {
  const worker = new EventEmitter() as EventEmitter & {
    waitUntilReady(): Promise<void>;
  };
  worker.waitUntilReady = async () => undefined;
  let health: MercadoLivreProjectionWorkerHealth = {
    running: true,
    activeJobId: null,
    lastJobId: null,
    lastOutcome: null,
    lastDurationMs: null,
    lastErrorCode: null,
    progress: null,
    ...input.health
  };
  return {
    worker,
    getHealth: () => ({ ...health }),
    async close() {
      input.onClose?.();
      health = { ...health, running: false, activeJobId: null };
    }
  };
}

test("dedicated runtime fails closed before database or Redis worker startup", async () => {
  let databaseChecks = 0;
  let workerCreations = 0;
  await assert.rejects(
    startMercadoLivreProjectionWorkerRuntime({
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "false",
      REDIS_URL: enabledEnvironment.REDIS_URL
    }, {
      validateDatabase: async () => {
        databaseChecks += 1;
      },
      createWorker: (() => {
        workerCreations += 1;
        return fakeController();
      }) as unknown as typeof createMercadoLivreProjectionWorker
    }),
    (error: unknown) => error instanceof MercadoLivreProjectionWorkerConfigurationError
      && error.code === "PROJECTION_WORKER_DISABLED"
  );
  assert.equal(databaseChecks, 0);
  assert.equal(workerCreations, 0);
});

test("runtime creates one worker and closes database and worker on SIGTERM", async () => {
  const signals = new EventEmitter();
  const events: MercadoLivreProjectionWorkerRuntimeEvent[] = [];
  let workerCreations = 0;
  let workerCloses = 0;
  let databaseChecks = 0;
  let databaseDisconnects = 0;
  const runtime = await startMercadoLivreProjectionWorkerRuntime(
    enabledEnvironment,
    {
      signalSource: signals,
      healthPollIntervalMs: 100,
      log: (event) => events.push(event),
      validateDatabase: async () => {
        databaseChecks += 1;
      },
      disconnectDatabase: async () => {
        databaseDisconnects += 1;
      },
      createWorker: (() => {
        workerCreations += 1;
        return fakeController({ onClose: () => { workerCloses += 1; } });
      }) as unknown as typeof createMercadoLivreProjectionWorker
    }
  );
  assert.equal(runtime.getHealth().running, true);
  signals.emit("SIGTERM");
  await runtime.done;
  await runtime.close();
  assert.equal(databaseChecks, 1);
  assert.equal(workerCreations, 1);
  assert.equal(workerCloses, 1);
  assert.equal(databaseDisconnects, 1);
  assert.deepEqual(events.map((event) => event.event), [
    "projection_worker_started",
    "projection_worker_health",
    "projection_worker_stopping",
    "projection_worker_stopped"
  ]);
  assert.doesNotMatch(
    JSON.stringify(events),
    /accessToken|refreshToken|Authorization|Bearer|secret/i
  );
});

test("runtime emits only sanitized job and error telemetry", async () => {
  const events: MercadoLivreProjectionWorkerRuntimeEvent[] = [];
  const controller = fakeController();
  const runtime = await startMercadoLivreProjectionWorkerRuntime(
    enabledEnvironment,
    {
      log: (event) => events.push(event),
      validateDatabase: async () => undefined,
      disconnectDatabase: async () => undefined,
      createWorker: ((input: Parameters<typeof createMercadoLivreProjectionWorker>[0]) => {
        input.onTelemetry?.({
          jobId: "job-safe",
          reason: "MANUAL_REFRESH",
          correlationId: "correlation-safe",
          generationId: "generation-safe",
          total: 2,
          staged: 2,
          catalogPages: 1,
          reconciliationPages: 1,
          batches: 1,
          maxConcurrency: 1,
          durationMs: 10,
          status: "COMPLETE",
          errorCode: null
        });
        return controller;
      }) as unknown as typeof createMercadoLivreProjectionWorker
    }
  );
  controller.worker.emit("active", { id: "job-safe" });
  controller.worker.emit("failed", { id: "job-safe" }, Object.assign(
    new Error("must not be logged"),
    { code: "SAFE_FAILURE_CODE" }
  ));
  await runtime.close();
  assert.match(JSON.stringify(events), /SAFE_FAILURE_CODE/);
  assert.doesNotMatch(JSON.stringify(events), /must not be logged/);
  assert.doesNotMatch(
    JSON.stringify(events),
    /accessToken|refreshToken|Authorization|Bearer|secret/i
  );
  assert.deepEqual(sanitizeMercadoLivreProjectionWorkerRuntimeError(
    Object.assign(new Error("sensitive message"), { code: "SAFE_FATAL" })
  ), {
    event: "projection_worker_fatal",
    errorClass: "Error",
    errorCode: "SAFE_FATAL"
  });
});

test("dedicated entrypoint and Compose profile stay isolated from Next.js", () => {
  const entrypoint = readFileSync(
    new URL("../../../scripts/workers/mercado-livre-projection-worker.ts", import.meta.url),
    "utf8"
  );
  const runtime = readFileSync(
    new URL("./mercado-livre-listing-projection-worker-runtime.ts", import.meta.url),
    "utf8"
  );
  const compose = readFileSync(
    new URL("../../../docker-compose.yml", import.meta.url),
    "utf8"
  );
  const packageJson = JSON.parse(readFileSync(
    new URL("../../../package.json", import.meta.url),
    "utf8"
  )) as { scripts: Record<string, string> };

  assert.match(entrypoint, /runMercadoLivreProjectionWorkerRuntime/);
  assert.doesNotMatch(entrypoint, /next|instrumentation|layout|route/);
  assert.doesNotMatch(runtime, /enqueueMercadoLivreProjectionFullSync|\.add\(/);
  assert.match(runtime, /SIGTERM/);
  assert.match(runtime, /SIGINT/);
  assert.match(runtime, /sourceFactory/);
  assert.match(runtime, /projection_worker_http_telemetry/);
  assert.match(runtime, /networkGets/);
  assert.match(runtime, /oauthRefreshes/);
  assert.match(compose, /ml-projection-worker:/);
  assert.match(compose, /profiles:\s*\n\s*- ml-projection-worker/);
  assert.match(compose, /MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true"/);
  assert.match(compose, /restart: "no"/);
  assert.doesNotMatch(
    compose.match(/ml-projection-worker:[\s\S]*?\n  postgres:/)?.[0] ?? "",
    /ports:/
  );
  assert.equal(
    packageJson.scripts["worker:ml-projection"],
    "tsx scripts/workers/mercado-livre-projection-worker.ts"
  );
});
