import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { QueueEvents } from "bullmq";
import {
  MercadoLivreListingProjectionFullSyncService
} from "./mercado-livre-listing-projection-full-sync-service";
import {
  createMercadoLivreProjectionQueue,
  createMercadoLivreProjectionWorker,
  enqueueMercadoLivreProjectionFullSync,
  mercadoLivreProjectionRedisConnection
} from "./mercado-livre-listing-projection-bullmq";
import { MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME } from "./mercado-livre-listing-projection-sync-job";
import { MercadoLivreListingProjectionService } from "./mercado-livre-listing-projection-service";
import { MercadoLivreListingProjectionRetentionService } from "./mercado-livre-listing-projection-retention-service";
import {
  FakeMercadoLivreProjectionSource,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const databaseUrl = process.env.ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL;
const redisUrl = process.env.ML_PROJECTION_REDIS_TEST_URL;

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for disposable integration condition");
}

test("BullMQ disposable worker completes one projection job and activates its snapshot", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const env = {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: redisUrl
  };
  const connectionOptions = mercadoLivreProjectionRedisConnection(env);
  const queue = createMercadoLivreProjectionQueue({ env, connection: connectionOptions });
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: connectionOptions
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 25 BullMQ",
      slug: `phase25-bullmq-${Date.now()}`
    }
  });
  const sellerId = "seller-phase25-bullmq";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 25",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const telemetry: Array<Record<string, unknown>> = [];
  const source = new FakeMercadoLivreProjectionSource({
    sellerId,
    initialIds: projectionIds(4)
  });
  const worker = createMercadoLivreProjectionWorker({
    env,
    connection: connectionOptions,
    sourceFactory(jobData) {
      assert.equal(jobData.organizationId, organization.id);
      assert.equal(jobData.marketplaceConnectionId, marketplaceConnection.id);
      assert.equal(jobData.sellerId, sellerId);
      return source;
    },
    serviceFactory(injectedSource) {
      return new MercadoLivreListingProjectionFullSyncService({
        source: injectedSource,
        lifecycle
      });
    },
    onTelemetry(event) {
      telemetry.push(event);
    }
  });

  try {
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady(), worker.worker.waitUntilReady()]);
    const job = await enqueueMercadoLivreProjectionFullSync({
      organizationId: organization.id,
      marketplaceConnectionId: marketplaceConnection.id,
      sellerId,
      correlationId: "phase25-bullmq-integration",
      reason: "INITIAL_BACKFILL",
      requestedBy: "integration-test"
    }, { env, queue });
    assert.equal(job.opts.attempts, 1);
    const result = await job.waitUntilFinished(queueEvents, 15_000) as {
      status: string;
      generationId: string;
      storedTotal: number;
    };
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.storedTotal, 4);
    const state = await database.mercadoLivreListingProjectionState.findUnique({
      where: {
        organizationId_marketplaceConnectionId_sellerId: {
          organizationId: organization.id,
          marketplaceConnectionId: marketplaceConnection.id,
          sellerId
        }
      },
      include: { activeGeneration: true }
    });
    assert.equal(state?.activeGenerationId, result.generationId);
    assert.equal(state?.activeGeneration?.status, "COMPLETE");
    assert.equal(await database.mercadoLivreListingProjection.count({
      where: { generationId: result.generationId }
    }), 4);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].jobId, String(job.id));
    assert.equal(telemetry[0].status, "COMPLETE");
    assert.deepEqual(Object.keys(job.data).sort(), [
      "correlationId",
      "marketplaceConnectionId",
      "organizationId",
      "reason",
      "requestedBy",
      "sellerId"
    ]);
    const persistedJob = await queue.getJob(String(job.id));
    assert.ok(persistedJob);
    assert.match(
      String((persistedJob.data as { recoveryGenerationId?: string }).recoveryGenerationId),
      /^mlpr_[a-f0-9]{32}$/
    );
    assert.equal(
      (persistedJob.data as { recoveryGenerationId?: string }).recoveryGenerationId,
      result.generationId
    );
    assert.doesNotMatch(JSON.stringify(job.data), /accessToken|refreshToken|Authorization|Bearer|secret/i);
    const health = worker.getHealth();
    assert.equal(health.running, true);
    assert.equal(health.activeJobId, null);
    assert.equal(health.lastJobId, String(job.id));
    assert.equal(health.lastOutcome, "COMPLETE");
  } finally {
    await worker.close();
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([
      queueEvents.close(),
      queue.close()
    ]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("SIGTERM-style close aborts the active job and preserves the previous snapshot", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const env = {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: redisUrl
  };
  const connectionOptions = mercadoLivreProjectionRedisConnection(env);
  const queue = createMercadoLivreProjectionQueue({ env, connection: connectionOptions });
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: connectionOptions
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 30 Shutdown",
      slug: `phase30-shutdown-${Date.now()}`
    }
  });
  const sellerId = "seller-phase30-shutdown";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 30 Shutdown",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const scope = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  const initial = await new MercadoLivreListingProjectionFullSyncService({
    source: new FakeMercadoLivreProjectionSource({
      sellerId,
      initialIds: projectionIds(2)
    }),
    lifecycle
  }).fullSync({ ...scope, correlationId: "phase30-shutdown-initial" });
  const blockingSource = new FakeMercadoLivreProjectionSource({
    sellerId,
    initialIds: projectionIds(2),
    detailDelayMs: 60_000
  });
  const worker = createMercadoLivreProjectionWorker({
    env,
    connection: connectionOptions,
    sourceFactory: () => blockingSource,
    serviceFactory: (source) => new MercadoLivreListingProjectionFullSyncService({
      source,
      lifecycle
    })
  });

  try {
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady(), worker.worker.waitUntilReady()]);
    const job = await enqueueMercadoLivreProjectionFullSync({
      ...scope,
      correlationId: "phase30-shutdown-active",
      reason: "MANUAL_REFRESH",
      requestedBy: "integration-test"
    }, { env, queue });
    const resultPromise = job.waitUntilFinished(queueEvents, 15_000).catch((error) => error);
    await waitFor(() => blockingSource.detailBatchCalls > 0);
    const building = await database.mercadoLivreListingProjectionGeneration.findFirst({
      where: { projectionStateId: (await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope }
      })).id, status: "BUILDING" }
    });
    assert.ok(building);
    assert.equal((await lifecycle.getProjectionReadiness(scope)).activeGenerationId, initial.generationId);

    await worker.close();
    const failure = await resultPromise;
    assert.ok(failure instanceof Error);
    const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
      where: { organizationId_marketplaceConnectionId_sellerId: scope }
    });
    const failedGeneration = await database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
      where: { id: building.id }
    });
    assert.equal(state.activeGenerationId, initial.generationId);
    assert.equal(failedGeneration.status, "ERROR");
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "BUILDING" }
    }), 0);
  } finally {
    await worker.close().catch(() => undefined);
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([queueEvents.close(), queue.close()]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("concurrent duplicate submissions produce one job and one complete generation", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const env = {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: redisUrl
  };
  const connectionOptions = mercadoLivreProjectionRedisConnection(env);
  const queue = createMercadoLivreProjectionQueue({ env, connection: connectionOptions });
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: connectionOptions
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 30 Deduplication",
      slug: `phase30-deduplication-${Date.now()}`
    }
  });
  const sellerId = "seller-phase30-deduplication";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 30 Deduplication",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const scope = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  let worker: ReturnType<typeof createMercadoLivreProjectionWorker> | null = null;

  try {
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady()]);
    await Promise.all([
      enqueueMercadoLivreProjectionFullSync({
        ...scope,
        correlationId: "phase30-duplicate-a",
        reason: "MANUAL_REFRESH"
      }, { env, queue }),
      enqueueMercadoLivreProjectionFullSync({
        ...scope,
        correlationId: "phase30-duplicate-b",
        reason: "MANUAL_REFRESH"
      }, { env, queue })
    ]);
    assert.equal(await queue.getWaitingCount(), 1);
    assert.equal(await queue.getJobCountByTypes("waiting", "active", "delayed"), 1);
    const [queuedJob] = await queue.getWaiting(0, 1);
    assert.ok(queuedJob);

    worker = createMercadoLivreProjectionWorker({
      env,
      connection: connectionOptions,
      sourceFactory: () => new FakeMercadoLivreProjectionSource({
        sellerId,
        initialIds: projectionIds(3)
      }),
      serviceFactory: (source) => new MercadoLivreListingProjectionFullSyncService({
        source,
        lifecycle
      })
    });
    await worker.worker.waitUntilReady();
    const result = await queuedJob.waitUntilFinished(queueEvents, 15_000) as {
      status: string;
      generationId: string;
    };
    assert.equal(result.status, "COMPLETE");
    const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
      where: { organizationId_marketplaceConnectionId_sellerId: scope }
    });
    assert.equal(state.activeGenerationId, result.generationId);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id }
    }), 1);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "BUILDING" }
    }), 0);
    assert.deepEqual(await queue.getJobCounts("completed", "failed", "waiting", "active"), {
      active: 0,
      completed: 1,
      failed: 0,
      paused: 0,
      waiting: 0
    });
  } finally {
    await worker?.close().catch(() => undefined);
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([queueEvents.close(), queue.close()]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("BullMQ runs retention after COMPLETE and keeps eight 254-row snapshots", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const retention = new MercadoLivreListingProjectionRetentionService(database);
  const env = {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: "true",
    REDIS_URL: redisUrl
  };
  const connectionOptions = mercadoLivreProjectionRedisConnection(env);
  const queue = createMercadoLivreProjectionQueue({ env, connection: connectionOptions });
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: connectionOptions
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 37 Post Sync Retention",
      slug: `phase37-retention-${Date.now()}`
    }
  });
  const sellerId = "seller-phase37-retention";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 37",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const scope = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  const source = new FakeMercadoLivreProjectionSource({
    sellerId,
    initialIds: projectionIds(254)
  });
  const historicalIds: string[] = [];
  let worker: ReturnType<typeof createMercadoLivreProjectionWorker> | null = null;

  try {
    for (let index = 0; index < 8; index += 1) {
      const historical = await new MercadoLivreListingProjectionFullSyncService({
        source,
        lifecycle
      }).fullSync({
        ...scope,
        correlationId: `phase37-history-${index}`
      });
      historicalIds.push(historical.generationId);
    }
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { organizationId: organization.id, status: "COMPLETE" }
    }), 8);
    assert.equal(await database.mercadoLivreListingProjection.count({
      where: { organizationId: organization.id }
    }), 2_032);

    const telemetry: Array<Record<string, unknown>> = [];
    worker = createMercadoLivreProjectionWorker({
      env,
      connection: connectionOptions,
      sourceFactory: () => source,
      serviceFactory: (injectedSource) => new MercadoLivreListingProjectionFullSyncService({
        source: injectedSource,
        lifecycle
      }),
      retentionService: retention,
      onTelemetry: (event) => telemetry.push(event)
    });
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady(), worker.worker.waitUntilReady()]);
    const job = await enqueueMercadoLivreProjectionFullSync({
      ...scope,
      correlationId: "phase37-bullmq-retention",
      reason: "MANUAL_REFRESH"
    }, { env, queue });
    const result = await job.waitUntilFinished(queueEvents, 30_000) as {
      status: string;
      generationId: string;
      retentionOutcome: string;
      retentionDeletedGenerations: number;
      retentionDeletedListings: number;
    };
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.retentionOutcome, "APPLIED");
    assert.equal(result.retentionDeletedGenerations, 1);
    assert.equal(result.retentionDeletedListings, 254);
    const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
      where: { organizationId_marketplaceConnectionId_sellerId: scope }
    });
    assert.equal(state.activeGenerationId, result.generationId);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "COMPLETE" }
    }), 8);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "BUILDING" }
    }), 0);
    assert.equal(await database.mercadoLivreListingProjection.count({
      where: { organizationId: organization.id }
    }), 2_032);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { id: historicalIds[0] }
    }), 0);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].retentionOutcome, "APPLIED");
    assert.equal(telemetry[0].retentionDeletedListings, 254);
    assert.equal(job.opts.attempts, 1);
    assert.deepEqual(await queue.getJobCounts("completed", "failed"), {
      completed: 1,
      failed: 0
    });
  } finally {
    await worker?.close().catch(() => undefined);
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([queueEvents.close(), queue.close()]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("BullMQ completes the job when only post-sync retention fails", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const retention = new MercadoLivreListingProjectionRetentionService(database);
  const env = {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: "true",
    REDIS_URL: redisUrl
  };
  const connectionOptions = mercadoLivreProjectionRedisConnection(env);
  const queue = createMercadoLivreProjectionQueue({ env, connection: connectionOptions });
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection: connectionOptions
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 37 Retention Failure",
      slug: `phase37-retention-failure-${Date.now()}`
    }
  });
  const sellerId = "seller-phase37-retention-failure";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 37 Failure",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const scope = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  const source = new FakeMercadoLivreProjectionSource({
    sellerId,
    initialIds: projectionIds(1)
  });
  let worker: ReturnType<typeof createMercadoLivreProjectionWorker> | null = null;

  try {
    for (let index = 0; index < 8; index += 1) {
      await new MercadoLivreListingProjectionFullSyncService({ source, lifecycle }).fullSync({
        ...scope,
        correlationId: `phase37-failure-history-${index}`
      });
    }
    const telemetry: Array<Record<string, unknown>> = [];
    worker = createMercadoLivreProjectionWorker({
      env,
      connection: connectionOptions,
      sourceFactory: () => source,
      serviceFactory: (injectedSource) => new MercadoLivreListingProjectionFullSyncService({
        source: injectedSource,
        lifecycle
      }),
      retentionService: {
        planRetention: (input) => retention.planRetention(input),
        applyRetention: async () => {
          throw Object.assign(new Error("must stay private"), {
            code: "PROJECTION_RETENTION_CONTROLLED_FAILURE"
          });
        }
      },
      onTelemetry: (event) => telemetry.push(event)
    });
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady(), worker.worker.waitUntilReady()]);
    const job = await enqueueMercadoLivreProjectionFullSync({
      ...scope,
      correlationId: "phase37-bullmq-retention-failure",
      reason: "MANUAL_REFRESH"
    }, { env, queue });
    const result = await job.waitUntilFinished(queueEvents, 30_000) as {
      status: string;
      generationId: string;
      retentionOutcome: string;
      retentionErrorCode: string | null;
    };
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.retentionOutcome, "FAILED");
    assert.equal(result.retentionErrorCode, "PROJECTION_RETENTION_CONTROLLED_FAILURE");
    const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
      where: { organizationId_marketplaceConnectionId_sellerId: scope }
    });
    assert.equal(state.activeGenerationId, result.generationId);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "COMPLETE" }
    }), 9);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { projectionStateId: state.id, status: "BUILDING" }
    }), 0);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].retentionOutcome, "FAILED");
    assert.equal(telemetry[0].retentionErrorCode, "PROJECTION_RETENTION_CONTROLLED_FAILURE");
    assert.doesNotMatch(JSON.stringify(telemetry), /must stay private/);
    assert.equal(worker.getHealth().lastOutcome, "COMPLETE");
    assert.equal(worker.getHealth().lastRetentionOutcome, "FAILED");
    assert.equal(job.opts.attempts, 1);
    assert.deepEqual(await queue.getJobCounts("completed", "failed"), {
      completed: 1,
      failed: 0
    });
  } finally {
    await worker?.close().catch(() => undefined);
    await queue.drain(true).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([queueEvents.close(), queue.close()]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});
