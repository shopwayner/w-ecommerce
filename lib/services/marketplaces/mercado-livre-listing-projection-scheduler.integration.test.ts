import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { QueueEvents } from "bullmq";
import { createMercadoLivreProjectionFreshnessPolicy } from "@/lib/mercado-livre-listing-projection-freshness";
import {
  createMercadoLivreProjectionQueueWithConnection,
  createMercadoLivreProjectionWorker,
  mercadoLivreProjectionRedisConnection
} from "./mercado-livre-listing-projection-bullmq";
import { MercadoLivreListingProjectionFullSyncService } from "./mercado-livre-listing-projection-full-sync-service";
import {
  createBullMqMercadoLivreProjectionSchedulerQueue,
  createPrismaMercadoLivreProjectionSchedulerRepository,
  MercadoLivreProjectionScheduler
} from "./mercado-livre-listing-projection-scheduler";
import { MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME } from "./mercado-livre-listing-projection-sync-job";
import { MercadoLivreListingProjectionService } from "./mercado-livre-listing-projection-service";
import {
  FakeMercadoLivreProjectionSource,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const databaseUrl = process.env.ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL;
const redisUrl = process.env.ML_PROJECTION_REDIS_TEST_URL;

test("two schedulers enqueue one slot and the next slot can complete a new generation", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const connection = mercadoLivreProjectionRedisConnection({
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: redisUrl
  });
  const rawQueueA = createMercadoLivreProjectionQueueWithConnection(connection);
  const rawQueueB = createMercadoLivreProjectionQueueWithConnection(connection);
  const queueA = createBullMqMercadoLivreProjectionSchedulerQueue(rawQueueA);
  const queueB = createBullMqMercadoLivreProjectionSchedulerQueue(rawQueueB);
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 31 Scheduler",
      slug: `phase31-scheduler-${Date.now()}`
    }
  });
  const sellerId = "seller-phase31-scheduler";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 31",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const target = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  const config = {
    enabled: true,
    policy: createMercadoLivreProjectionFreshnessPolicy(),
    targets: [target],
    tickMs: 60_000
  };
  let clock = new Date();
  const repository = createPrismaMercadoLivreProjectionSchedulerRepository(database as never);
  const schedulerA = new MercadoLivreProjectionScheduler({
    config,
    repository,
    queue: queueA,
    now: () => clock
  });
  const schedulerB = new MercadoLivreProjectionScheduler({
    config,
    repository,
    queue: queueB,
    now: () => clock
  });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const worker = createMercadoLivreProjectionWorker({
    env: {
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
      REDIS_URL: redisUrl
    },
    connection,
    sourceFactory: () => new FakeMercadoLivreProjectionSource({
      sellerId,
      initialIds: projectionIds(4)
    }),
    serviceFactory: (source) => new MercadoLivreListingProjectionFullSyncService({
      source,
      lifecycle
    })
  });

  try {
    await Promise.all([
      rawQueueA.waitUntilReady(),
      rawQueueB.waitUntilReady(),
      queueEvents.waitUntilReady()
    ]);
    const simultaneous = await Promise.all([schedulerA.tick(), schedulerB.tick()]);
    assert.deepEqual(simultaneous.flat().map((result) => result.decision), [
      "ENQUEUED",
      "ENQUEUED"
    ]);
    assert.equal(await rawQueueA.getJobCountByTypes("waiting", "active", "delayed"), 1);
    const firstJob = await rawQueueA.getJob(simultaneous[0][0].jobId ?? "missing");
    assert.ok(firstJob);

    await worker.worker.waitUntilReady();
    const firstResult = await firstJob.waitUntilFinished(queueEvents, 15_000) as {
      status: string;
      generationId: string;
    };
    assert.equal(firstResult.status, "COMPLETE");
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { organizationId: organization.id }
    }), 1);

    assert.equal((await schedulerA.tick())[0].decision, "SKIP_NOT_DUE");
    clock = new Date(Date.now() + config.policy.cadenceMs);
    const nextSlot = await schedulerA.tick();
    assert.equal(nextSlot[0].decision, "ENQUEUED");
    assert.notEqual(nextSlot[0].jobId, String(firstJob.id));
    const secondJob = await rawQueueA.getJob(nextSlot[0].jobId ?? "missing");
    assert.ok(secondJob);
    const secondResult = await secondJob.waitUntilFinished(queueEvents, 15_000) as {
      status: string;
      generationId: string;
    };
    assert.equal(secondResult.status, "COMPLETE");
    assert.notEqual(secondResult.generationId, firstResult.generationId);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { organizationId: organization.id, status: "COMPLETE" }
    }), 2);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { organizationId: organization.id, status: "BUILDING" }
    }), 0);
  } finally {
    await worker.close().catch(() => undefined);
    await rawQueueA.drain(true).catch(() => undefined);
    await rawQueueA.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([
      queueEvents.close(),
      queueA.close(),
      queueB.close()
    ]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});

test("the next scheduler slot can replace a recovered ERROR generation", {
  skip: databaseUrl && redisUrl
    ? false
    : "Disposable PostgreSQL and Redis URLs are not configured"
}, async () => {
  assert.ok(databaseUrl);
  assert.ok(redisUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const connection = mercadoLivreProjectionRedisConnection({
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    REDIS_URL: redisUrl
  });
  const rawQueue = createMercadoLivreProjectionQueueWithConnection(connection);
  const queue = createBullMqMercadoLivreProjectionSchedulerQueue(rawQueue);
  const queueEvents = new QueueEvents(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, {
    connection
  });
  const organization = await database.organization.create({
    data: {
      name: "Phase 39A1 Scheduler Recovery",
      slug: `phase39a1-scheduler-recovery-${Date.now()}`
    }
  });
  const sellerId = "seller-phase39a1-scheduler-recovery";
  const marketplaceConnection = await database.marketplaceConnection.create({
    data: {
      organizationId: organization.id,
      provider: "MERCADOLIVRE",
      accountAlias: "ML Phase 39A1",
      status: "ACTIVE",
      configStatus: "READY",
      sellerId
    }
  });
  const target = {
    organizationId: organization.id,
    marketplaceConnectionId: marketplaceConnection.id,
    sellerId
  };
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const source = new FakeMercadoLivreProjectionSource({
    sellerId,
    initialIds: projectionIds(4)
  });
  const directSync = new MercadoLivreListingProjectionFullSyncService({ source, lifecycle });
  const policy = createMercadoLivreProjectionFreshnessPolicy();
  const scheduler = new MercadoLivreProjectionScheduler({
    config: {
      enabled: true,
      policy,
      targets: [target],
      tickMs: 60_000
    },
    repository: createPrismaMercadoLivreProjectionSchedulerRepository(database as never),
    queue,
    now: () => new Date(Date.now() + policy.cadenceMs)
  });
  const worker = createMercadoLivreProjectionWorker({
    env: {
      MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
      REDIS_URL: redisUrl
    },
    connection,
    sourceFactory: () => source,
    serviceFactory: (injectedSource) => new MercadoLivreListingProjectionFullSyncService({
      source: injectedSource,
      lifecycle
    })
  });

  try {
    await Promise.all([
      rawQueue.waitUntilReady(),
      queueEvents.waitUntilReady()
    ]);
    const baseline = await directSync.fullSync({
      ...target,
      correlationId: "phase39a1-scheduler-baseline"
    });
    const crashedGenerationId = `mlpr_${"a".repeat(32)}`;
    await lifecycle.beginProjectionGeneration({
      ...target,
      generationId: crashedGenerationId
    });
    await lifecycle.failProjectionGeneration({
      ...target,
      generationId: crashedGenerationId,
      errorCode: "PROJECTION_STALLED_JOB_ABORTED",
      errorSummary: "Recovered stalled projection job was terminated safely."
    });

    const nextSlot = await scheduler.tick();
    assert.equal(nextSlot[0].decision, "ENQUEUED");
    const nextJob = await rawQueue.getJob(nextSlot[0].jobId ?? "missing");
    assert.ok(nextJob);
    await worker.worker.waitUntilReady();
    const result = await nextJob.waitUntilFinished(queueEvents, 15_000) as {
      status: string;
      generationId: string;
    };

    assert.equal(result.status, "COMPLETE");
    assert.notEqual(result.generationId, crashedGenerationId);
    assert.notEqual(result.generationId, baseline.generationId);
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { ...target, status: "BUILDING" }
    }), 0);
    assert.equal((await lifecycle.getProjectionReadiness(target)).activeGenerationId, result.generationId);
  } finally {
    await worker.close().catch(() => undefined);
    await rawQueue.drain(true).catch(() => undefined);
    await rawQueue.obliterate({ force: true }).catch(() => undefined);
    await Promise.all([
      queueEvents.close(),
      queue.close()
    ]);
    await database.organization.delete({ where: { id: organization.id } }).catch(() => undefined);
    await database.$disconnect();
  }
});
