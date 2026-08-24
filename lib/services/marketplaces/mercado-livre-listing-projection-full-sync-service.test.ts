import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MercadoLivreListingProjectionFullSyncService,
  MercadoLivreProjectionFullSyncError
} from "./mercado-livre-listing-projection-full-sync-service";
import {
  MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME,
  MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS,
  processMercadoLivreProjectionSyncJob
} from "./mercado-livre-listing-projection-sync-job";
import { normalizeMercadoLivreProjectionSourceDetail } from "./mercado-livre-listing-projection-source";
import {
  FakeMercadoLivreProjectionLifecycle,
  FakeMercadoLivreProjectionSource,
  asProjectionLifecycle,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const scope = {
  organizationId: "organization-phase24",
  marketplaceConnectionId: "connection-phase24",
  sellerId: "seller-phase24"
};

function fullSync(input: {
  source: FakeMercadoLivreProjectionSource;
  lifecycle?: FakeMercadoLivreProjectionLifecycle;
}) {
  const lifecycle = input.lifecycle ?? new FakeMercadoLivreProjectionLifecycle();
  return {
    lifecycle,
    service: new MercadoLivreListingProjectionFullSyncService({
      source: input.source,
      lifecycle: asProjectionLifecycle(lifecycle)
    })
  };
}

function expectFullSyncError(code: string) {
  return (error: unknown) => (
    error instanceof MercadoLivreProjectionFullSyncError && error.code === code
  );
}

test("source adapter preserves normalized projection fields and unknown stock", () => {
  const syncedAt = new Date("2026-08-24T12:00:00.000Z");
  const normalized = normalizeMercadoLivreProjectionSourceDetail({
    expectedSellerId: scope.sellerId,
    syncedAt,
    detail: {
      sellerId: scope.sellerId,
      mlbId: "MLB1234567890",
      title: "Produto",
      sku: "SKU-1",
      gtin: "7891234567895",
      status: "active",
      subStatus: ["catalog_listing_eligible"],
      health: 0.8,
      listingTypeId: "gold_special",
      availableQuantity: null,
      price: 19.9,
      currencyId: "BRL",
      thumbnail: "https://example.test/image.jpg",
      categoryId: "MLB1234",
      permalink: "https://example.test/item",
      dateCreated: "2026-08-20T10:00:00.000Z",
      remoteUpdatedAt: "2026-08-24T11:00:00.000Z"
    }
  });
  assert.equal(normalized.availableQuantity, null);
  assert.equal(normalized.syncedAt?.toISOString(), syncedAt.toISOString());
  assert.equal(normalized.mlbId, "MLB1234567890");
  assert.equal(normalized.currencyId, "BRL");
});

for (const total of [254, 1_000, 10_000]) {
  test(`full sync covers all ${total} listings without a silent limit`, async () => {
    const source = new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds: projectionIds(total),
      detailDelayMs: total === 254 ? 1 : 0
    });
    const { service, lifecycle } = fullSync({ source });
    const startedAt = performance.now();
    const result = await service.fullSync({
      ...scope,
      correlationId: `phase24-${total}`
    });
    const elapsedMs = performance.now() - startedAt;
    const expectedPages = Math.ceil(total / 100);
    const expectedBatches = Math.ceil(total / 20);
    assert.equal(result.status, "COMPLETE");
    assert.equal(result.expectedTotal, total);
    assert.equal(result.storedTotal, total);
    assert.equal(result.catalogPages, expectedPages);
    assert.equal(result.reconciliationPages, expectedPages);
    assert.equal(result.detailBatches, expectedBatches);
    assert.equal(source.catalogPageCalls, expectedPages * 2);
    assert.equal(source.detailBatchCalls, expectedBatches);
    assert.ok(result.maxConcurrency <= 2);
    assert.ok(source.maxDetailConcurrency <= 2);
    assert.equal(lifecycle.generations.get(result.generationId)?.rows.size, total);
    assert.equal(lifecycle.readiness, "READY");
    assert.ok(elapsedMs >= 0);
  });
}

test("catalog reconciliation ignores order but rejects a changed set", async () => {
  const initialIds = projectionIds(4);
  const reordered = [initialIds[3], initialIds[1], initialIds[0], initialIds[2]];
  const sameSet = fullSync({
    source: new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds,
      finalIds: reordered
    })
  });
  assert.equal((await sameSet.service.fullSync({
    ...scope,
    correlationId: "phase24-reordered"
  })).status, "COMPLETE");

  const changedIds = [initialIds[0], initialIds[1], initialIds[2], "MLB9999999999"];
  const changed = fullSync({
    source: new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds,
      finalIds: changedIds
    })
  });
  await assert.rejects(
    changed.service.fullSync({ ...scope, correlationId: "phase24-changed" }),
    expectFullSyncError("PROJECTION_SOURCE_CHANGED")
  );
  assert.equal(changed.lifecycle.finalizeCalls, 0);
  assert.equal(changed.lifecycle.failCalls, 1);
  assert.equal(changed.lifecycle.readiness, "ERROR_WITHOUT_SNAPSHOT");
});

test("identity mismatch is rejected before a generation is created", async () => {
  const source = new FakeMercadoLivreProjectionSource({
    sellerId: scope.sellerId,
    identitySellerId: "foreign-seller",
    initialIds: projectionIds(1)
  });
  const { service, lifecycle } = fullSync({ source });
  await assert.rejects(
    service.fullSync({ ...scope, correlationId: "phase24-identity-mismatch" }),
    expectFullSyncError("PROJECTION_SOURCE_SELLER_MISMATCH")
  );
  assert.equal(lifecycle.beginCalls, 0);
  assert.equal(source.metadataCalls, 0);
});

test("progress and telemetry expose only aggregate full-sync facts", async () => {
  const progress: string[] = [];
  const telemetry: Array<Record<string, unknown>> = [];
  const { service } = fullSync({
    source: new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds: projectionIds(10)
    })
  });
  await service.fullSync({
    ...scope,
    correlationId: "phase24-observability",
    onProgress: (event) => progress.push(event.stage),
    onTelemetry: (event) => telemetry.push(event)
  });
  assert.equal(progress[0], "VALIDATING");
  assert.ok(progress.includes("READING_IDS"));
  assert.ok(progress.includes("STAGING"));
  assert.ok(progress.includes("RECONCILING"));
  assert.ok(progress.includes("FINALIZING"));
  assert.equal(progress.at(-1), "COMPLETED");
  assert.equal(telemetry.length, 1);
  assert.deepEqual(Object.keys(telemetry[0]).sort(), [
    "batches",
    "catalogPages",
    "correlationId",
    "durationMs",
    "errorCode",
    "generationId",
    "maxConcurrency",
    "reconciliationPages",
    "staged",
    "status",
    "total"
  ]);
});

test("pagination rejects missing, duplicate and inconsistent pages", async (t) => {
  const ids = projectionIds(101);
  await t.test("missing ID", async () => {
    const { service } = fullSync({
      source: new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: ids,
        pageTransform: (page) => ({
          ids: page.offset === 0 ? page.ids.slice(1) : page.ids
        })
      })
    });
    await assert.rejects(
      service.fullSync({ ...scope, correlationId: "phase24-page-missing" }),
      expectFullSyncError("PROJECTION_PAGINATION_INCOMPLETE")
    );
  });
  await t.test("duplicate ID", async () => {
    const { service } = fullSync({
      source: new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: ids,
        pageTransform: (page) => ({
          ids: page.offset === 100 ? [ids[0]] : page.ids
        })
      })
    });
    await assert.rejects(
      service.fullSync({ ...scope, correlationId: "phase24-page-duplicate" }),
      expectFullSyncError("PROJECTION_CATALOG_DUPLICATE_ID")
    );
  });
  await t.test("wrong offset", async () => {
    const { service } = fullSync({
      source: new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: ids,
        pageTransform: (page) => ({ ids: page.ids, offset: page.offset + 1 })
      })
    });
    await assert.rejects(
      service.fullSync({ ...scope, correlationId: "phase24-page-offset" }),
      expectFullSyncError("PROJECTION_PAGINATION_INVALID")
    );
  });
});

test("detail integrity rejects missing, duplicate, unexpected and foreign-seller rows", async (t) => {
  const ids = projectionIds(2);
  const scenarios = [
    {
      name: "missing",
      code: "PROJECTION_DETAIL_COVERAGE_MISMATCH",
      transform: (details: Parameters<NonNullable<ConstructorParameters<typeof FakeMercadoLivreProjectionSource>[0]["detailsTransform"]>>[0]) => details.slice(1)
    },
    {
      name: "duplicate",
      code: "PROJECTION_DETAIL_DUPLICATE_ID",
      transform: (details: Parameters<NonNullable<ConstructorParameters<typeof FakeMercadoLivreProjectionSource>[0]["detailsTransform"]>>[0]) => [details[0], details[0]]
    },
    {
      name: "unexpected",
      code: "PROJECTION_DETAIL_UNEXPECTED_ID",
      transform: (details: Parameters<NonNullable<ConstructorParameters<typeof FakeMercadoLivreProjectionSource>[0]["detailsTransform"]>>[0]) => [
        details[0],
        { ...details[1], mlbId: "MLB9999999999" }
      ]
    },
    {
      name: "foreign seller",
      code: "PROJECTION_DETAIL_SELLER_MISMATCH",
      transform: (details: Parameters<NonNullable<ConstructorParameters<typeof FakeMercadoLivreProjectionSource>[0]["detailsTransform"]>>[0]) => [
        { ...details[0], sellerId: "foreign-seller" },
        details[1]
      ]
    }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { service, lifecycle } = fullSync({
        source: new FakeMercadoLivreProjectionSource({
          sellerId: scope.sellerId,
          initialIds: ids,
          detailsTransform: scenario.transform
        })
      });
      await assert.rejects(
        service.fullSync({ ...scope, correlationId: `phase24-detail-${scenario.name}` }),
        expectFullSyncError(scenario.code)
      );
      assert.equal(lifecycle.finalizeCalls, 0);
      assert.equal(lifecycle.failCalls, 1);
    });
  }
});

test("batch failure stops future work and a later job uses a new generation", async () => {
  const lifecycle = new FakeMercadoLivreProjectionLifecycle();
  const failingSource = new FakeMercadoLivreProjectionSource({
    sellerId: scope.sellerId,
    initialIds: projectionIds(1_000),
    detailDelayMs: 1,
    failDetailBatchAt: 37
  });
  const failing = fullSync({ source: failingSource, lifecycle });
  await assert.rejects(
    failing.service.fullSync({ ...scope, correlationId: "phase24-batch-failure" }),
    expectFullSyncError("PROJECTION_SOURCE_FAILED")
  );
  assert.ok(failingSource.detailBatchCalls <= 38);
  assert.equal(lifecycle.finalizeCalls, 0);
  assert.equal(lifecycle.failCalls, 1);
  const failedGenerationId = [...lifecycle.generations.keys()][0];
  assert.equal(lifecycle.generations.get(failedGenerationId)?.status, "ERROR");

  const succeeding = fullSync({
    lifecycle,
    source: new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds: projectionIds(10)
    })
  });
  const result = await succeeding.service.fullSync({
    ...scope,
    correlationId: "phase24-recovery"
  });
  assert.equal(result.status, "COMPLETE");
  assert.notEqual(result.generationId, failedGenerationId);
  assert.equal(lifecycle.generations.get(failedGenerationId)?.status, "ERROR");
});

test("external cancellation and job budget fail closed", async (t) => {
  await t.test("external cancellation", async () => {
    const controller = new AbortController();
    const { service, lifecycle } = fullSync({
      source: new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(100),
        detailDelayMs: 50
      })
    });
    setTimeout(() => controller.abort(), 2);
    await assert.rejects(
      service.fullSync({
        ...scope,
        correlationId: "phase24-cancelled",
        signal: controller.signal
      }),
      expectFullSyncError("PROJECTION_SYNC_CANCELLED")
    );
    assert.equal(lifecycle.finalizeCalls, 0);
    assert.equal(lifecycle.readiness, "ERROR_WITHOUT_SNAPSHOT");
  });
  await t.test("budget", async () => {
    const { service, lifecycle } = fullSync({
      source: new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(100),
        detailDelayMs: 50
      })
    });
    await assert.rejects(
      service.fullSync({
        ...scope,
        correlationId: "phase24-budget",
        budgetMs: 2
      }),
      expectFullSyncError("PROJECTION_SYNC_BUDGET_EXCEEDED")
    );
    assert.equal(lifecycle.finalizeCalls, 0);
    assert.equal(lifecycle.readiness, "ERROR_WITHOUT_SNAPSHOT");
  });
});

test("concurrent jobs cannot leave two BUILDING generations", async () => {
  const lifecycle = new FakeMercadoLivreProjectionLifecycle();
  const services = [1, 2].map((suffix) => fullSync({
    lifecycle,
    source: new FakeMercadoLivreProjectionSource({
      sellerId: scope.sellerId,
      initialIds: projectionIds(100),
      detailDelayMs: 10 + suffix
    })
  }).service);
  const results = await Promise.allSettled(services.map((service, index) => service.fullSync({
    ...scope,
    correlationId: `phase24-concurrent-${index}`
  })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    [...lifecycle.generations.values()].filter((generation) => generation.status === "BUILDING").length,
    0
  );
});

test("job contract is allowlisted and delegates without registering BullMQ", async () => {
  assert.equal(MERCADO_LIVRE_LISTING_PROJECTION_QUEUE_NAME, "mercado-livre-listing-projection");
  assert.deepEqual(MERCADO_LIVRE_PROJECTION_SYNC_TRIGGER_REASONS, [
    "INITIAL_BACKFILL",
    "PERIODIC_RECONCILIATION",
    "MANUAL_REFRESH",
    "RECOVERY"
  ]);
  let received: Record<string, unknown> | null = null;
  await processMercadoLivreProjectionSyncJob({
    ...scope,
    correlationId: "phase24-job",
    reason: "MANUAL_REFRESH",
    requestedBy: "user-safe-id"
  }, {
    fullSyncService: {
      async fullSync(input) {
        received = input;
        return {
          status: "COMPLETE",
          generationId: "generation",
          expectedTotal: 0,
          storedTotal: 0,
          catalogHash: "hash",
          catalogPages: 0,
          reconciliationPages: 0,
          detailBatches: 0,
          maxConcurrency: 0,
          durationMs: 1
        };
      }
    }
  });
  assert.deepEqual(Object.keys(received ?? {}).sort(), [
    "budgetMs",
    "correlationId",
    "marketplaceConnectionId",
    "onProgress",
    "onTelemetry",
    "organizationId",
    "sellerId",
    "signal"
  ]);

  const runtimeSources = [
    "mercado-livre-listing-projection-source.ts",
    "mercado-livre-listing-projection-full-sync-service.ts",
    "mercado-livre-listing-projection-sync-job.ts"
  ].map((file) => readFileSync(path.join(
    process.cwd(),
    "lib/services/marketplaces",
    file
  ), "utf8")).join("\n");
  assert.doesNotMatch(runtimeSources, /\bfetch\s*\(/);
  assert.doesNotMatch(runtimeSources, /new\s+(Worker|Queue)\s*\(/);
  assert.doesNotMatch(runtimeSources, /accessToken|refreshToken|Authorization|Bearer/);
});
