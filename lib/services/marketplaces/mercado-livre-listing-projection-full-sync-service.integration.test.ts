import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  MercadoLivreListingProjectionFullSyncService,
  MercadoLivreProjectionFullSyncError
} from "./mercado-livre-listing-projection-full-sync-service";
import { MercadoLivreListingProjectionService } from "./mercado-livre-listing-projection-service";
import {
  FakeMercadoLivreProjectionSource,
  projectionIds
} from "./testing/mercado-livre-listing-projection-fakes";

const isolatedPostgresUrl = process.env.ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL;

type Scope = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
};

function expectFullSyncError(code: string) {
  return (error: unknown) => (
    error instanceof MercadoLivreProjectionFullSyncError && error.code === code
  );
}

test("PostgreSQL isolated full sync builds and switches only complete snapshots", {
  skip: isolatedPostgresUrl ? false : "ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL is not configured"
}, async (t) => {
  assert.ok(isolatedPostgresUrl);
  const database = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const organizationIds: string[] = [];
  let sequence = 0;

  async function createScope(label: string): Promise<Scope> {
    sequence += 1;
    const suffix = `${label}-${sequence}`;
    const organization = await database.organization.create({
      data: { name: `Phase 24 ${suffix}`, slug: `phase24-${suffix}` }
    });
    organizationIds.push(organization.id);
    const sellerId = `seller-${suffix}`;
    const connection = await database.marketplaceConnection.create({
      data: {
        organizationId: organization.id,
        provider: "MERCADOLIVRE",
        accountAlias: `ML ${suffix}`,
        status: "ACTIVE",
        configStatus: "CONFIGURED",
        sellerId
      }
    });
    return {
      organizationId: organization.id,
      marketplaceConnectionId: connection.id,
      sellerId
    };
  }

  function service(scope: Scope, source: FakeMercadoLivreProjectionSource) {
    assert.equal(source.options.sellerId, scope.sellerId);
    return new MercadoLivreListingProjectionFullSyncService({ source, lifecycle });
  }

  try {
    await t.test("first success and G1 to G2 switch preserve history and nullable stock", async () => {
      const scope = await createScope("success");
      const firstIds = projectionIds(4);
      const firstSource = new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: firstIds,
        finalIds: [firstIds[3], firstIds[1], firstIds[0], firstIds[2]],
        detailFactory: (id) => ({
          mlbId: id,
          sellerId: scope.sellerId,
          title: `Produto ${id}`,
          status: "active",
          listingTypeId: "gold_special",
          availableQuantity: id === firstIds[0] ? null : 0,
          currencyId: "BRL"
        })
      });
      const first = await service(scope, firstSource).fullSync({
        ...scope,
        correlationId: "phase24-first-success"
      });
      assert.equal(first.status, "COMPLETE");
      assert.equal((await lifecycle.getProjectionReadiness(scope)).readiness, "READY");
      const unknownStock = await database.mercadoLivreListingProjection.findUniqueOrThrow({
        where: { generationId_mlbId: { generationId: first.generationId, mlbId: firstIds[0] } }
      });
      assert.equal(unknownStock.availableQuantity, null);

      const secondIds = projectionIds(254, 1_000);
      const second = await service(scope, new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: secondIds,
        detailDelayMs: 1
      })).fullSync({
        ...scope,
        correlationId: "phase24-second-success"
      });
      assert.equal(second.expectedTotal, 254);
      assert.equal(second.storedTotal, 254);
      assert.equal(second.catalogPages, 3);
      assert.equal(second.detailBatches, 13);

      const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope },
        include: { generations: { orderBy: { startedAt: "asc" } } }
      });
      assert.equal(state.activeGenerationId, second.generationId);
      assert.equal(state.status, "COMPLETE");
      assert.equal(state.generations.length, 2);
      assert.equal(state.generations[0].id, first.generationId);
      assert.equal(state.generations[0].status, "COMPLETE");
      assert.equal(state.generations[1].status, "COMPLETE");
    });

    await t.test("failure around item 700 leaves a partial ERROR generation and keeps G1 active", async () => {
      const scope = await createScope("partial-failure");
      const active = await service(scope, new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(1)
      })).fullSync({ ...scope, correlationId: "phase24-partial-active" });

      const failingSource = new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(1_000, 10_000),
        detailDelayMs: 1,
        failDetailBatchAt: 37
      });
      await assert.rejects(
        service(scope, failingSource).fullSync({
          ...scope,
          correlationId: "phase24-partial-failure"
        }),
        expectFullSyncError("PROJECTION_SOURCE_FAILED")
      );
      const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope },
        include: { generations: { orderBy: { startedAt: "asc" } } }
      });
      const failed = state.generations.at(-1)!;
      const staged = await database.mercadoLivreListingProjection.count({
        where: { generationId: failed.id }
      });
      assert.equal(state.activeGenerationId, active.generationId);
      assert.equal(state.status, "ERROR");
      assert.equal(failed.status, "ERROR");
      assert.ok(staged >= 680 && staged <= 740);
      assert.equal((await lifecycle.getProjectionReadiness(scope)).readiness, "ERROR_WITH_ACTIVE_SNAPSHOT");
    });

    await t.test("first failure has no active snapshot and can be retried later", async () => {
      const scope = await createScope("first-failure");
      await assert.rejects(
        service(scope, new FakeMercadoLivreProjectionSource({
          sellerId: scope.sellerId,
          initialIds: projectionIds(100),
          failDetailBatchAt: 2
        })).fullSync({ ...scope, correlationId: "phase24-first-failure" }),
        expectFullSyncError("PROJECTION_SOURCE_FAILED")
      );
      const failedReadiness = await lifecycle.getProjectionReadiness(scope);
      assert.equal(failedReadiness.readiness, "ERROR_WITHOUT_SNAPSHOT");
      assert.equal(failedReadiness.activeGenerationId, null);

      const recovered = await service(scope, new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(10, 1_000)
      })).fullSync({ ...scope, correlationId: "phase24-first-recovery" });
      assert.equal(recovered.status, "COMPLETE");
      const generations = await database.mercadoLivreListingProjectionGeneration.findMany({
        where: scope,
        orderBy: { startedAt: "asc" }
      });
      assert.deepEqual(generations.map((generation) => generation.status), ["ERROR", "COMPLETE"]);
    });

    await t.test("changed source never activates the staged generation", async () => {
      const scope = await createScope("source-changed");
      const active = await service(scope, new FakeMercadoLivreProjectionSource({
        sellerId: scope.sellerId,
        initialIds: projectionIds(2)
      })).fullSync({ ...scope, correlationId: "phase24-source-active" });
      const initialIds = projectionIds(100, 5_000);
      const changedIds = [...initialIds.slice(0, -1), "MLB9999999999"];
      await assert.rejects(
        service(scope, new FakeMercadoLivreProjectionSource({
          sellerId: scope.sellerId,
          initialIds,
          finalIds: changedIds
        })).fullSync({ ...scope, correlationId: "phase24-source-changed" }),
        expectFullSyncError("PROJECTION_SOURCE_CHANGED")
      );
      const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope },
        include: { generations: { orderBy: { startedAt: "asc" } } }
      });
      assert.equal(state.activeGenerationId, active.generationId);
      assert.equal(state.generations.at(-1)?.status, "ERROR");
    });

    await t.test("concurrent jobs use the PostgreSQL generation lock", async () => {
      const scope = await createScope("concurrent");
      const services = [1, 2].map((suffix) => service(
        scope,
        new FakeMercadoLivreProjectionSource({
          sellerId: scope.sellerId,
          initialIds: projectionIds(100),
          detailDelayMs: 15 + suffix
        })
      ));
      const results = await Promise.allSettled(services.map((fullSync, index) => fullSync.fullSync({
        ...scope,
        correlationId: `phase24-real-concurrent-${index}`
      })));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { ...scope, status: "BUILDING" }
      }), 0);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { ...scope, status: "COMPLETE" }
      }), 1);
    });

    await t.test("cross-tenant scope fails before consulting the source", async () => {
      const scopeA = await createScope("tenant-a");
      const scopeB = await createScope("tenant-b");
      const source = new FakeMercadoLivreProjectionSource({
        sellerId: scopeB.sellerId,
        initialIds: projectionIds(1)
      });
      const fullSync = new MercadoLivreListingProjectionFullSyncService({ source, lifecycle });
      await assert.rejects(
        fullSync.fullSync({
          organizationId: scopeA.organizationId,
          marketplaceConnectionId: scopeB.marketplaceConnectionId,
          sellerId: scopeB.sellerId,
          correlationId: "phase24-cross-tenant"
        }),
        expectFullSyncError("PROJECTION_SCOPE_INVALID")
      );
      assert.equal(source.metadataCalls, 0);
      assert.equal(source.catalogPageCalls, 0);
      assert.equal(source.detailBatchCalls, 0);
    });
  } finally {
    if (organizationIds.length > 0) {
      await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await database.$disconnect();
  }
});
