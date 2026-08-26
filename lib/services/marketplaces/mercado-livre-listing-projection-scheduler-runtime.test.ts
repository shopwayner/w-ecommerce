import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  MercadoLivreProjectionSchedulerQueue,
  MercadoLivreProjectionSchedulerRepository
} from "./mercado-livre-listing-projection-scheduler";
import {
  sanitizeMercadoLivreProjectionSchedulerRuntimeError,
  startMercadoLivreProjectionSchedulerRuntime,
  type MercadoLivreProjectionSchedulerRuntimeEvent
} from "./mercado-livre-listing-projection-scheduler-runtime";

class Signals extends EventEmitter {
  override once(event: "SIGINT" | "SIGTERM", listener: () => void) {
    return super.once(event, listener);
  }
  off(event: "SIGINT" | "SIGTERM", listener: () => void) {
    return super.off(event, listener);
  }
}

const target = {
  organizationId: "organization-runtime",
  marketplaceConnectionId: "connection-runtime",
  sellerId: "seller-runtime"
};
const environment = {
  MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
  MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: JSON.stringify([target]),
  DATABASE_URL: "postgresql://not-used.invalid/test"
};

function queue(onEnqueue?: () => void): MercadoLivreProjectionSchedulerQueue {
  return {
    async hasPendingJob() { return false; },
    async enqueue() {
      onEnqueue?.();
      return { id: "job-runtime" };
    },
    async close() {}
  };
}

function repository(): MercadoLivreProjectionSchedulerRepository {
  return {
    async getConnection() {
      return {
        provider: "MERCADOLIVRE",
        status: "ACTIVE",
        configStatus: "READY",
        sellerId: target.sellerId
      };
    },
    async getProjectionState() {
      return {
        stateStatus: null,
        activeGeneration: null,
        lastSuccessfulSyncAt: null,
        lastAttemptFinishedAt: null,
        hasBuildingGeneration: false
      };
    }
  };
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for scheduler runtime condition");
}

test("scheduler runtime fails closed when disabled", async () => {
  await assert.rejects(() => startMercadoLivreProjectionSchedulerRuntime({}, {
    validateDatabase: async () => undefined,
    queue: queue(),
    repository: repository()
  }), /PROJECTION_SCHEDULER_DISABLED/);
});

test("enabled scheduler with an empty allowlist starts healthy and enqueues nobody", async () => {
  const events: MercadoLivreProjectionSchedulerRuntimeEvent[] = [];
  let enqueues = 0;
  const runtime = await startMercadoLivreProjectionSchedulerRuntime({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "[]",
    DATABASE_URL: "postgresql://not-used.invalid/test"
  }, {
    validateDatabase: async () => undefined,
    disconnectDatabase: async () => undefined,
    repository: repository(),
    queue: queue(() => { enqueues += 1; }),
    log: (event) => events.push(event),
    sleep: (_duration, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    })
  });
  await waitFor(() => runtime.getHealth().lastDecision === "NO_TARGETS");
  assert.equal(runtime.getHealth().configuredTargets, 0);
  assert.equal(enqueues, 0);
  await runtime.close();
  assert.equal(runtime.getHealth().running, false);
  assert.doesNotMatch(JSON.stringify(events), /accessToken|refreshToken|Authorization|Bearer|secret/i);
});

test("SIGTERM during a tick waits for that evaluation and starts no overlapping tick", async () => {
  const signals = new Signals();
  let releaseConnection!: () => void;
  let connectionCalls = 0;
  let enqueues = 0;
  const connectionGate = new Promise<void>((resolve) => { releaseConnection = resolve; });
  const delayedRepository: MercadoLivreProjectionSchedulerRepository = {
    ...repository(),
    async getConnection() {
      connectionCalls += 1;
      await connectionGate;
      return repository().getConnection(target);
    }
  };
  const runtime = await startMercadoLivreProjectionSchedulerRuntime(environment, {
    signalSource: signals,
    validateDatabase: async () => undefined,
    disconnectDatabase: async () => undefined,
    repository: delayedRepository,
    queue: queue(() => { enqueues += 1; }),
    log: () => undefined,
    sleep: async () => assert.fail("shutdown must prevent a second tick")
  });
  await waitFor(() => connectionCalls === 1);
  signals.emit("SIGTERM");
  releaseConnection();
  await runtime.done;
  assert.equal(connectionCalls, 1);
  assert.equal(enqueues, 1);
  assert.equal(runtime.getHealth().running, false);
});

test("runtime error telemetry is stable and excludes complete messages", () => {
  assert.deepEqual(sanitizeMercadoLivreProjectionSchedulerRuntimeError(
    Object.assign(new Error("Bearer sensitive"), { code: "SAFE_SCHEDULER_FATAL" })
  ), {
    event: "projection_scheduler_fatal",
    errorClass: "Error",
    errorCode: "SAFE_SCHEDULER_FATAL"
  });
});

test("scheduler entrypoint and Compose profile are dedicated, dark and portless", () => {
  const entrypoint = readFileSync(
    new URL("../../../scripts/workers/mercado-livre-projection-scheduler.ts", import.meta.url),
    "utf8"
  );
  const runtime = readFileSync(
    new URL("./mercado-livre-listing-projection-scheduler-runtime.ts", import.meta.url),
    "utf8"
  );
  const compose = readFileSync(
    new URL("../../../docker-compose.yml", import.meta.url),
    "utf8"
  );
  const envExample = readFileSync(
    new URL("../../../.env.example", import.meta.url),
    "utf8"
  );
  const packageJson = JSON.parse(readFileSync(
    new URL("../../../package.json", import.meta.url),
    "utf8"
  )) as { scripts: Record<string, string> };

  assert.match(entrypoint, /runMercadoLivreProjectionSchedulerRuntime/);
  assert.doesNotMatch(entrypoint, /next|route|layout/);
  assert.match(runtime, /while \(!stopping\)/);
  assert.doesNotMatch(runtime, /setInterval/);
  assert.match(runtime, /SIGTERM/);
  assert.match(runtime, /SIGINT/);
  const service = compose.match(/ml-projection-scheduler:[\s\S]*?\n  postgres:/)?.[0] ?? "";
  assert.match(service, /profiles:\s*\n\s*- ml-projection-scheduler/);
  assert.match(service, /restart: "no"/);
  assert.doesNotMatch(service, /ports:/);
  assert.match(envExample, /^MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED=false$/m);
  assert.match(envExample, /^MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS=\[\]$/m);
  assert.equal(
    packageJson.scripts["scheduler:ml-projection"],
    "tsx scripts/workers/mercado-livre-projection-scheduler.ts"
  );
});
