import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MERCADO_LIVRE_PROJECTION_JOB_NAME,
  MERCADO_LIVRE_PROJECTION_WORKER_FLAG,
  MercadoLivreProjectionWorkerConfigurationError,
  enqueueScheduledMercadoLivreProjectionFullSync,
  enqueueMercadoLivreProjectionFullSync,
  hasPendingMercadoLivreProjectionJob,
  isMercadoLivreProjectionWorkerEnabled,
  mercadoLivreProjectionRedisConnection
} from "./mercado-livre-listing-projection-bullmq";
import {
  MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME,
  MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS,
  normalizeMercadoLivreProjectionSyncJobData
} from "./mercado-livre-listing-projection-sync-job";

test("projection worker feature flag fails closed", () => {
  assert.equal(isMercadoLivreProjectionWorkerEnabled({}), false);
  assert.equal(isMercadoLivreProjectionWorkerEnabled({ MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "false" }), false);
  assert.equal(isMercadoLivreProjectionWorkerEnabled({ MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "TRUE" }), false);
  assert.equal(isMercadoLivreProjectionWorkerEnabled({ MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "1" }), false);
  assert.equal(isMercadoLivreProjectionWorkerEnabled({ MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true" }), true);
  assert.equal(MERCADO_LIVRE_PROJECTION_WORKER_FLAG, "MERCADO_LIVRE_PROJECTION_WORKER_ENABLED");
});

test("disabled flag prevents Redis configuration from being consumed", () => {
  assert.throws(
    () => mercadoLivreProjectionRedisConnection({
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "false",
      REDIS_URL: "redis://must-not-be-used.invalid:6379/0"
    }),
    (error: unknown) => error instanceof MercadoLivreProjectionWorkerConfigurationError
      && error.code === "PROJECTION_WORKER_DISABLED"
  );
  assert.throws(
    () => mercadoLivreProjectionRedisConnection({
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true"
    }),
    (error: unknown) => error instanceof MercadoLivreProjectionWorkerConfigurationError
      && error.code === "PROJECTION_REDIS_NOT_CONFIGURED"
  );
});

test("Redis connection parsing is strict and never returns the original URL", () => {
  const connection = mercadoLivreProjectionRedisConnection({
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: "rediss://worker:secret@example.test:6380/4"
  });
  const options = connection as Record<string, unknown>;
  assert.equal(options.host, "example.test");
  assert.equal(options.port, 6380);
  assert.equal(options.username, "worker");
  assert.equal(options.password, "secret");
  assert.equal(options.db, 4);
  assert.deepEqual(options.tls, {});
  assert.equal("url" in options, false);
  assert.throws(
    () => mercadoLivreProjectionRedisConnection({
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
      REDIS_URL: "https://example.test"
    }),
    (error: unknown) => error instanceof MercadoLivreProjectionWorkerConfigurationError
      && error.code === "PROJECTION_REDIS_URL_INVALID"
  );
});

test("job contract remains allowlisted and contains no credentials", () => {
  const normalized = normalizeMercadoLivreProjectionSyncJobData({
    organizationId: "organization-1",
    marketplaceConnectionId: "connection-1",
    sellerId: "seller-1",
    correlationId: "correlation-1",
    reason: "INITIAL_BACKFILL",
    requestedBy: "system"
  });
  assert.deepEqual(Object.keys(normalized).sort(), [
    "correlationId",
    "marketplaceConnectionId",
    "organizationId",
    "reason",
    "requestedBy",
    "sellerId"
  ]);
  assert.doesNotMatch(JSON.stringify(normalized), /accessToken|refreshToken|Authorization|Bearer|secret/i);
  assert.deepEqual(MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS, [
    "INITIAL_BACKFILL",
    "PERIODIC_RECONCILIATION",
    "MANUAL_REFRESH",
    "RECOVERY"
  ]);
  assert.equal(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, "mercado-livre-listing-projection");
  assert.equal(MERCADO_LIVRE_PROJECTION_JOB_NAME, "full-sync");
});

test("producer uses attempts one and a scope deduplication key without credentials", async () => {
  const calls: Array<{ name: unknown; data: unknown; options: Record<string, unknown> }> = [];
  const queue = {
    async add(name: unknown, data: unknown, options: Record<string, unknown>) {
      calls.push({ name, data, options });
      return { id: options.jobId, data, opts: options };
    }
  };
  await enqueueMercadoLivreProjectionFullSync({
    organizationId: "organization-1",
    marketplaceConnectionId: "connection-1",
    sellerId: "seller-1",
    correlationId: "correlation-1",
    reason: "MANUAL_REFRESH"
  }, {
    env: { MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true" },
    queue: queue as never
  });
  assert.equal(calls.length, 1);
  const captured = calls[0];
  assert.equal(captured.name, "full-sync");
  assert.equal(captured.options.attempts, 1);
  assert.match(String(captured.options.jobId), /^ml-projection-[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(captured.options.deduplication as object), ["id"]);
  assert.doesNotMatch(JSON.stringify(captured), /accessToken|refreshToken|Authorization|Bearer|secret/i);
});

test("scheduled producer deduplicates one target per cadence slot without blocking future slots", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const queue = {
    async add(_name: unknown, _data: unknown, options: Record<string, unknown>) {
      calls.push(options);
      return { id: options.jobId };
    }
  };
  const data = {
    organizationId: "organization-1",
    marketplaceConnectionId: "connection-1",
    sellerId: "seller-1",
    correlationId: "scheduler-100-safe",
    reason: "PERIODIC_RECONCILIATION" as const,
    requestedBy: "projection-scheduler"
  };
  await enqueueScheduledMercadoLivreProjectionFullSync(data, {
    slot: 100,
    queue: queue as never
  });
  await enqueueScheduledMercadoLivreProjectionFullSync(data, {
    slot: 100,
    queue: queue as never
  });
  await enqueueScheduledMercadoLivreProjectionFullSync({
    ...data,
    correlationId: "scheduler-101-safe"
  }, {
    slot: 101,
    queue: queue as never
  });
  assert.equal(calls[0].jobId, calls[1].jobId);
  assert.notEqual(calls[1].jobId, calls[2].jobId);
  assert.equal(calls[0].attempts, 1);
  assert.match(String(calls[0].jobId), /^ml-projection-scheduled-[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(calls), /organization-1|connection-1|seller-1/);
});

test("pending job detection considers waiting, active and delayed work for the exact target", async () => {
  const queue = {
    async getJobs() {
      return [{
        data: {
          organizationId: "organization-1",
          marketplaceConnectionId: "connection-1",
          sellerId: "seller-1",
          correlationId: "safe",
          reason: "PERIODIC_RECONCILIATION"
        }
      }];
    }
  };
  assert.equal(await hasPendingMercadoLivreProjectionJob(queue as never, {
    organizationId: "organization-1",
    marketplaceConnectionId: "connection-1",
    sellerId: "seller-1"
  }), true);
  assert.equal(await hasPendingMercadoLivreProjectionJob(queue as never, {
    organizationId: "organization-1",
    marketplaceConnectionId: "connection-1",
    sellerId: "other-seller"
  }), false);
});

test("BullMQ module has no import-time worker, queue or producer side effect", () => {
  const source = readFileSync(
    new URL("./mercado-livre-listing-projection-bullmq.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /export const\s+\w+\s*=\s*new (?:Worker|Queue)/);
  assert.doesNotMatch(source, /process\.on\(|setInterval\(|setTimeout\(/);
  assert.doesNotMatch(source, /accessToken|refreshToken|Authorization|Bearer/);
  assert.match(source, /attempts:\s*1/);
  assert.match(source, /deduplication:/);
});

test("environment example documents the worker as disabled", () => {
  const envExample = readFileSync(
    new URL("../../../.env.example", import.meta.url),
    "utf8"
  );
  assert.match(envExample, /^MERCADO_LIVRE_PROJECTION_WORKER_ENABLED=false$/m);
  assert.match(envExample, /^MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED=false$/m);
});
