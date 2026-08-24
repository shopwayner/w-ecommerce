import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  MercadoLivreListingProjectionError,
  MercadoLivreListingProjectionService
} from "./mercado-livre-listing-projection-service";

const isolatedPostgresUrl = process.env.ML_PROJECTION_TEST_DATABASE_URL;

type Scope = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
};

function listing(mlbId: string, availableQuantity: number | null = 1) {
  return {
    mlbId,
    title: `Produto ${mlbId}`,
    sku: `SKU-${mlbId}`,
    status: "active",
    subStatus: ["catalog_listing_eligible"],
    health: 0.95,
    listingTypeId: "gold_special",
    availableQuantity,
    price: 19.9,
    currencyId: "BRL",
    dateCreated: "2026-08-24T10:00:00.000Z",
    remoteUpdatedAt: "2026-08-24T11:00:00.000Z"
  };
}

function expectProjectionError(code: string) {
  return (error: unknown) => (
    error instanceof MercadoLivreListingProjectionError && error.code === code
  );
}

test("PostgreSQL isolated projection lifecycle is atomic, idempotent and tenant-safe", {
  skip: isolatedPostgresUrl ? false : "ML_PROJECTION_TEST_DATABASE_URL is not configured"
}, async (t) => {
  assert.ok(isolatedPostgresUrl);
  const database = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl } } });
  const service = new MercadoLivreListingProjectionService(database);
  const organizationIds: string[] = [];
  let fixtureSequence = 0;

  async function createScope(label: string): Promise<Scope> {
    fixtureSequence += 1;
    const suffix = `${label}-${fixtureSequence}`;
    const organization = await database.organization.create({
      data: { name: `Phase 23 ${suffix}`, slug: `phase23-${suffix}` }
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

  async function createActiveGeneration(scope: Scope, prefix: string, total = 1) {
    const begun = await service.beginProjectionGeneration({ ...scope, expectedTotal: total });
    await service.stageProjectionListings({
      ...scope,
      generationId: begun.generation.id,
      listings: Array.from({ length: total }, (_, index) => listing(`${prefix}-${index + 1}`))
    });
    const finalized = await service.finalizeProjectionGeneration({
      ...scope,
      generationId: begun.generation.id
    });
    assert.equal(finalized.status, "COMPLETE");
    assert.equal(finalized.activated, true);
    return begun.generation.id;
  }

  try {
    await t.test("successful switch preserves history and exact staged values", async () => {
      const scope = await createScope("success");
      const firstGenerationId = await createActiveGeneration(scope, "G1");
      const second = await service.beginProjectionGeneration({ ...scope, expectedTotal: 3 });

      const syncing = await service.getProjectionReadiness(scope);
      assert.equal(syncing.readiness, "SYNCING_WITH_ACTIVE_SNAPSHOT");
      assert.equal(syncing.activeGenerationId, firstGenerationId);

      const batch = [listing("G2-1", null), listing("G2-2", 0), listing("G2-3", 4)];
      const firstStage = await service.stageProjectionListings({
        ...scope,
        generationId: second.generation.id,
        listings: batch
      });
      const repeatedStage = await service.stageProjectionListings({
        ...scope,
        generationId: second.generation.id,
        listings: [batch[0], batch[0], batch[1], batch[2]]
      });
      assert.equal(firstStage.storedTotal, 3);
      assert.equal(repeatedStage.storedTotal, 3);

      const quantities = await database.mercadoLivreListingProjection.findMany({
        where: { generationId: second.generation.id },
        orderBy: { mlbId: "asc" },
        select: { availableQuantity: true }
      });
      assert.deepEqual(quantities.map((row) => row.availableQuantity), [null, 0, 4]);

      const finalized = await service.finalizeProjectionGeneration({
        ...scope,
        generationId: second.generation.id
      });
      const repeatedFinalize = await service.finalizeProjectionGeneration({
        ...scope,
        generationId: second.generation.id
      });
      assert.equal(finalized.storedTotal, 3);
      assert.equal(repeatedFinalize.idempotent, true);

      const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope },
        include: { activeGeneration: true, generations: { orderBy: { startedAt: "asc" } } }
      });
      assert.equal(state.status, "COMPLETE");
      assert.equal(state.activeGenerationId, second.generation.id);
      assert.ok(state.lastSuccessfulSyncAt);
      assert.equal(state.generations.length, 2);
      assert.equal(state.generations[0].id, firstGenerationId);
      assert.equal(state.generations[0].status, "COMPLETE");
      assert.equal(state.activeGeneration?.organizationId, scope.organizationId);
      assert.equal(state.activeGeneration?.marketplaceConnectionId, scope.marketplaceConnectionId);
      assert.equal(state.activeGeneration?.sellerId, scope.sellerId);
      assert.equal(state.activeGeneration?.status, "COMPLETE");
      assert.equal(state.activeGeneration?.expectedTotal, state.activeGeneration?.storedTotal);
      assert.equal((await service.getProjectionReadiness(scope)).readiness, "READY");
      await assert.rejects(
        service.stageProjectionListings({
          ...scope,
          generationId: second.generation.id,
          listings: [listing("AFTER-COMPLETE")]
        }),
        expectProjectionError("PROJECTION_GENERATION_NOT_BUILDING")
      );
      await assert.rejects(
        service.failProjectionGeneration({ ...scope, generationId: second.generation.id }),
        expectProjectionError("PROJECTION_COMPLETE_GENERATION_IMMUTABLE")
      );
    });

    await t.test("total mismatch and explicit failure preserve the active snapshot", async () => {
      const scope = await createScope("failure-with-active");
      const activeGenerationId = await createActiveGeneration(scope, "ACTIVE");
      const mismatch = await service.beginProjectionGeneration({ ...scope, expectedTotal: 3 });
      await service.stageProjectionListings({
        ...scope,
        generationId: mismatch.generation.id,
        listings: [listing("MISMATCH-1"), listing("MISMATCH-2")]
      });
      const result = await service.finalizeProjectionGeneration({
        ...scope,
        generationId: mismatch.generation.id
      });
      assert.equal(result.status, "ERROR");
      assert.equal(result.errorCode, "PROJECTION_TOTAL_MISMATCH");
      assert.equal((await service.finalizeProjectionGeneration({
        ...scope,
        generationId: mismatch.generation.id
      })).idempotent, true);

      const stateAfterMismatch = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { organizationId_marketplaceConnectionId_sellerId: scope }
      });
      assert.equal(stateAfterMismatch.activeGenerationId, activeGenerationId);
      assert.equal(stateAfterMismatch.status, "ERROR");
      assert.equal((await service.getProjectionReadiness(scope)).readiness, "ERROR_WITH_ACTIVE_SNAPSHOT");
      await assert.rejects(
        service.stageProjectionListings({
          ...scope,
          generationId: mismatch.generation.id,
          listings: [listing("AFTER-ERROR")]
        }),
        expectProjectionError("PROJECTION_GENERATION_NOT_BUILDING")
      );

      const failed = await service.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
      const firstFailure = await service.failProjectionGeneration({
        ...scope,
        generationId: failed.generation.id,
        errorCode: "vendor secret=hidden\nrequest failed",
        errorSummary: "Authorization=credential Bearer abc.def"
      });
      const repeatedFailure = await service.failProjectionGeneration({
        ...scope,
        generationId: failed.generation.id,
        errorCode: "ignored",
        errorSummary: "ignored"
      });
      assert.equal(firstFailure.idempotent, false);
      assert.equal(repeatedFailure.idempotent, true);
      const persistedFailure = await database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
        where: { id: failed.generation.id }
      });
      assert.equal(persistedFailure.status, "ERROR");
      assert.ok(persistedFailure.failedAt);
      assert.doesNotMatch(persistedFailure.errorCode ?? "", /HIDDEN/);
      assert.doesNotMatch(persistedFailure.errorSummary ?? "", /credential|abc\.def/);
      assert.equal((await service.getProjectionReadiness(scope)).activeGenerationId, activeGenerationId);
    });

    await t.test("first synchronization exposes without-snapshot readiness states", async () => {
      const scope = await createScope("first-sync");
      const neverSynced = await service.getProjectionReadiness(scope);
      assert.equal(neverSynced.readiness, "NEVER_SYNCED");
      assert.equal(neverSynced.activeGenerationId, null);

      const begun = await service.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
      assert.equal((await service.getProjectionReadiness(scope)).readiness, "SYNCING_WITHOUT_SNAPSHOT");
      await service.failProjectionGeneration({
        ...scope,
        generationId: begun.generation.id,
        errorCode: "FIRST_SYNC_FAILED",
        errorSummary: "Controlled failure"
      });
      const failed = await service.getProjectionReadiness(scope);
      assert.equal(failed.readiness, "ERROR_WITHOUT_SNAPSHOT");
      assert.equal(failed.activeGenerationId, null);
    });

    await t.test("scope validation blocks cross-tenant and wrong-seller operations", async () => {
      const scopeA = await createScope("tenant-a");
      const scopeB = await createScope("tenant-b");
      const otherProviderOrganization = await database.organization.create({
        data: { name: "Phase 23 other provider", slug: `phase23-other-${fixtureSequence}` }
      });
      organizationIds.push(otherProviderOrganization.id);
      const otherProviderConnection = await database.marketplaceConnection.create({
        data: {
          organizationId: otherProviderOrganization.id,
          provider: "AMAZON",
          accountAlias: "Not Mercado Livre",
          sellerId: "seller-other-provider"
        }
      });
      await assert.rejects(
        service.beginProjectionGeneration({
          organizationId: otherProviderOrganization.id,
          marketplaceConnectionId: otherProviderConnection.id,
          sellerId: "seller-other-provider",
          expectedTotal: 1
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );
      await assert.rejects(
        service.beginProjectionGeneration({
          ...scopeA,
          marketplaceConnectionId: scopeB.marketplaceConnectionId,
          sellerId: scopeB.sellerId,
          expectedTotal: 1
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );

      const generationB = await service.beginProjectionGeneration({ ...scopeB, expectedTotal: 1 });
      const foreignScope = { ...scopeA, sellerId: scopeB.sellerId };
      await assert.rejects(
        service.stageProjectionListings({
          ...foreignScope,
          generationId: generationB.generation.id,
          listings: [listing("FOREIGN")]
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );
      await assert.rejects(
        service.finalizeProjectionGeneration({
          ...foreignScope,
          generationId: generationB.generation.id
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );
      await assert.rejects(
        service.failProjectionGeneration({
          ...foreignScope,
          generationId: generationB.generation.id
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );
      await assert.rejects(
        service.stageProjectionListings({
          ...scopeB,
          sellerId: "wrong-seller",
          generationId: generationB.generation.id,
          listings: [listing("WRONG-SELLER")]
        }),
        expectProjectionError("PROJECTION_SCOPE_INVALID")
      );
    });

    await t.test("concurrent begin, finalize and fail serialize safely", async () => {
      const beginScope = await createScope("concurrent-begin");
      const begins = await Promise.allSettled([
        service.beginProjectionGeneration({ ...beginScope, expectedTotal: 1 }),
        service.beginProjectionGeneration({ ...beginScope, expectedTotal: 1 })
      ]);
      assert.equal(begins.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(begins.filter((result) => result.status === "rejected").length, 1);
      const rejectedBegin = begins.find((result) => result.status === "rejected");
      assert.ok(rejectedBegin?.status === "rejected");
      assert.ok(expectProjectionError("PROJECTION_GENERATION_ALREADY_BUILDING")(
        rejectedBegin.reason
      ));
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { ...beginScope, status: "BUILDING" }
      }), 1);

      const finalizeScope = await createScope("concurrent-finalize");
      const finalizing = await service.beginProjectionGeneration({
        ...finalizeScope,
        expectedTotal: 1
      });
      await service.stageProjectionListings({
        ...finalizeScope,
        generationId: finalizing.generation.id,
        listings: [listing("FINALIZE")]
      });
      const finalizations = await Promise.all([
        service.finalizeProjectionGeneration({
          ...finalizeScope,
          generationId: finalizing.generation.id
        }),
        service.finalizeProjectionGeneration({
          ...finalizeScope,
          generationId: finalizing.generation.id
        })
      ]);
      assert.deepEqual(finalizations.map((result) => result.status), ["COMPLETE", "COMPLETE"]);
      assert.equal(finalizations.filter((result) => result.idempotent).length, 1);

      const failScope = await createScope("concurrent-fail");
      const failing = await service.beginProjectionGeneration({ ...failScope, expectedTotal: 1 });
      const failures = await Promise.all([
        service.failProjectionGeneration({ ...failScope, generationId: failing.generation.id }),
        service.failProjectionGeneration({ ...failScope, generationId: failing.generation.id })
      ]);
      assert.equal(failures.filter((result) => result.idempotent).length, 1);
      assert.equal((await service.getProjectionReadiness(failScope)).readiness, "ERROR_WITHOUT_SNAPSHOT");
    });

    await t.test("stage and finalize race never activates an incomplete generation", async () => {
      const scope = await createScope("stage-finalize-race");
      const begun = await service.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
      const results = await Promise.allSettled([
        service.stageProjectionListings({
          ...scope,
          generationId: begun.generation.id,
          listings: [listing("RACE")]
        }),
        service.finalizeProjectionGeneration({ ...scope, generationId: begun.generation.id })
      ]);
      const generation = await database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
        where: { id: begun.generation.id },
        include: { projectionState: true, _count: { select: { listings: true } } }
      });
      assert.notEqual(generation.status, "BUILDING");
      if (generation.projectionState.activeGenerationId === generation.id) {
        assert.equal(generation.status, "COMPLETE");
        assert.equal(generation.storedTotal, 1);
        assert.equal(generation._count.listings, 1);
      } else {
        assert.equal(generation.status, "ERROR");
        assert.equal(generation.projectionState.activeGenerationId, null);
      }
      assert.ok(results.some((result) => result.status === "fulfilled"));
    });

    await t.test("activation failure rolls back generation and keeps the previous snapshot", async () => {
      const scope = await createScope("rollback");
      const firstGenerationId = await createActiveGeneration(scope, "ROLLBACK-G1");
      const second = await service.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
      await service.stageProjectionListings({
        ...scope,
        generationId: second.generation.id,
        listings: [listing("ROLLBACK-G2")]
      });

      const suffix = second.generation.id.replace(/[^A-Za-z0-9]/g, "").slice(-20);
      const functionName = `phase23_fail_activation_${suffix}`;
      const triggerName = `phase23_fail_activation_trigger_${suffix}`;
      const generationId = second.generation.id.replace(/'/g, "''");
      await database.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
        BEGIN
          IF NEW."activeGenerationId" = '${generationId}' THEN
            RAISE EXCEPTION 'controlled phase23 activation failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await database.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}"
        BEFORE UPDATE ON "MercadoLivreListingProjectionState"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);
      try {
        await assert.rejects(service.finalizeProjectionGeneration({
          ...scope,
          generationId: second.generation.id
        }), /controlled phase23 activation failure/);
      } finally {
        await database.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "MercadoLivreListingProjectionState"`
        );
        await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
      }

      const [state, first, rolledBack] = await Promise.all([
        database.mercadoLivreListingProjectionState.findUniqueOrThrow({
          where: { organizationId_marketplaceConnectionId_sellerId: scope }
        }),
        database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
          where: { id: firstGenerationId }
        }),
        database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
          where: { id: second.generation.id }
        })
      ]);
      assert.equal(state.activeGenerationId, firstGenerationId);
      assert.equal(state.status, "SYNCING");
      assert.equal(first.status, "COMPLETE");
      assert.equal(rolledBack.status, "BUILDING");
      assert.equal(rolledBack.completedAt, null);
    });
  } finally {
    if (organizationIds.length > 0) {
      await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await database.$disconnect();
  }
});
