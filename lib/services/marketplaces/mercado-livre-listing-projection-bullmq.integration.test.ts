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
import {
  FakeMercadoLivreProjectionSource,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const databaseUrl = process.env.ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL;
const redisUrl = process.env.ML_PROJECTION_REDIS_TEST_URL;

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
