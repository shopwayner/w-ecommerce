import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { MercadoLivreListingProjectionService } from "./mercado-livre-listing-projection-service";
import {
  MercadoLivreListingProjectionRetentionService,
  MercadoLivreProjectionRetentionError
} from "./mercado-livre-listing-projection-retention-service";

const isolatedPostgresUrl = process.env.ML_PROJECTION_TEST_DATABASE_URL;

type Scope = {
  organizationId: string;
  marketplaceConnectionId: string;
  sellerId: string;
};

test("PostgreSQL projection retention is atomic, tenant-safe and lifecycle-compatible", {
  skip: isolatedPostgresUrl ? false : "ML_PROJECTION_TEST_DATABASE_URL is not configured"
}, async (t) => {
  assert.ok(isolatedPostgresUrl);
  const database = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl } } });
  const retention = new MercadoLivreListingProjectionRetentionService(database);
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const organizationIds: string[] = [];
  let sequence = 0;

  async function createScope(label: string, sellerId?: string): Promise<Scope> {
    sequence += 1;
    const suffix = `${Date.now()}-${sequence}`;
    const organization = await database.organization.create({
      data: { name: `Retention ${label}`, slug: `retention-${label}-${suffix}` }
    });
    organizationIds.push(organization.id);
    const connection = await database.marketplaceConnection.create({
      data: {
        organizationId: organization.id,
        provider: "MERCADOLIVRE",
        accountAlias: `Retention ${label}`,
        status: "ACTIVE",
        configStatus: "READY",
        sellerId: sellerId ?? `seller-${suffix}`
      }
    });
    return {
      organizationId: organization.id,
      marketplaceConnectionId: connection.id,
      sellerId: connection.sellerId!
    };
  }

  async function createSeries(input: {
    scope: Scope;
    complete?: number;
    errors?: number;
    listingsPerGeneration?: number;
    activeOrdinal?: number | null;
  }) {
    const state = await database.mercadoLivreListingProjectionState.create({
      data: { ...input.scope, status: "NEVER_SYNCED" }
    });
    const generations: Array<{ id: string; status: "COMPLETE" | "ERROR" }> = [];
    const startedBase = new Date("2026-08-27T00:00:00.000Z").getTime();
    const complete = input.complete ?? 0;
    const errors = input.errors ?? 0;
    const listingsPerGeneration = input.listingsPerGeneration ?? 1;
    for (let index = 0; index < complete + errors; index += 1) {
      const status = index < complete ? "COMPLETE" as const : "ERROR" as const;
      const timestamp = new Date(startedBase + index * 60_000);
      const generation = await database.mercadoLivreListingProjectionGeneration.create({
        data: {
          projectionStateId: state.id,
          ...input.scope,
          status,
          expectedTotal: listingsPerGeneration,
          storedTotal: listingsPerGeneration,
          startedAt: timestamp,
          completedAt: status === "COMPLETE" ? timestamp : null,
          failedAt: status === "ERROR" ? timestamp : null,
          errorCode: status === "ERROR" ? "CONTROLLED_ERROR" : null,
          errorSummary: status === "ERROR" ? "Controlled retention fixture" : null
        }
      });
      generations.push({ id: generation.id, status });
      if (listingsPerGeneration > 0) {
        await database.mercadoLivreListingProjection.createMany({
          data: Array.from({ length: listingsPerGeneration }, (_, listingIndex) => ({
            organizationId: input.scope.organizationId,
            marketplaceConnectionId: input.scope.marketplaceConnectionId,
            sellerId: input.scope.sellerId,
            generationId: generation.id,
            mlbId: `MLB${String(index + 1).padStart(4, "0")}${String(listingIndex + 1).padStart(5, "0")}`,
            title: "Controlled retention fixture",
            status: "active",
            listingTypeId: "gold_special"
          }))
        });
      }
    }
    const activeOrdinal = input.activeOrdinal === undefined ? complete : input.activeOrdinal;
    const activeGenerationId = activeOrdinal
      ? generations[activeOrdinal - 1]?.id ?? null
      : null;
    await database.mercadoLivreListingProjectionState.update({
      where: { id: state.id },
      data: {
        status: activeGenerationId ? "COMPLETE" : errors > 0 ? "ERROR" : "NEVER_SYNCED",
        activeGenerationId,
        lastSuccessfulSyncAt: activeGenerationId ? new Date() : null
      }
    });
    return { stateId: state.id, generations, activeGenerationId };
  }

  async function installDeleteTrigger(input: {
    stateId: string;
    label: string;
    body: string;
  }) {
    const safeLabel = `${input.label}_${sequence}`.replace(/[^a-z0-9_]/gi, "").slice(0, 40);
    const functionName = `retention_${safeLabel}_fn`;
    const triggerName = `retention_${safeLabel}_trigger`;
    const stateId = input.stateId.replace(/'/g, "''");
    await database.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF OLD."projectionStateId" = '${stateId}' THEN
          ${input.body}
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await database.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE DELETE ON "MercadoLivreListingProjectionGeneration"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    return async () => {
      await database.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON "MercadoLivreListingProjectionGeneration"`
      );
      await database.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    };
  }

  try {
    await t.test("empty scope plans and applies without writes", async () => {
      const scope = await createScope("empty");
      const plan = await retention.planRetention({ scope });
      assert.equal(plan.totalGenerations, 0);
      assert.equal(plan.candidates.length, 0);
      const result = await retention.applyRetention(plan);
      assert.deepEqual(
        { generations: result.deletedGenerations, listings: result.deletedListingRows },
        { generations: 0, listings: 0 }
      );
    });

    await t.test("cascade cleanup is scoped and a second plan/apply is idempotent", async () => {
      const sharedSeller = `shared-seller-${sequence}`;
      const scopeA = await createScope("tenant-a", sharedSeller);
      const scopeB = await createScope("tenant-b", sharedSeller);
      const fixtureA = await createSeries({ scope: scopeA, complete: 11, listingsPerGeneration: 2 });
      await createSeries({ scope: scopeB, complete: 11, listingsPerGeneration: 2 });
      const planA = await retention.planRetention({ scope: scopeA });
      assert.equal(planA.candidates.length, 3);
      assert.equal(planA.candidateListingRows, 6);
      assert.ok(!planA.candidates.some(({ generationId }) => generationId === fixtureA.activeGenerationId));
      const beforeB = await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scopeB.organizationId }
      });
      const applied = await retention.applyRetention(planA);
      assert.equal(applied.deletedGenerations, 3);
      assert.equal(applied.deletedListingRows, 6);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scopeA.organizationId }
      }), 8);
      assert.equal(await database.mercadoLivreListingProjection.count({
        where: { organizationId: scopeA.organizationId }
      }), 16);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scopeB.organizationId }
      }), beforeB);
      const secondPlan = await retention.planRetention({ scope: scopeA });
      const second = await retention.applyRetention(secondPlan);
      assert.equal(second.deletedGenerations, 0);
      assert.equal(second.deletedListingRows, 0);
    });

    await t.test("BUILDING blocks cleanup and partial ERROR rows cascade", async () => {
      const buildingScope = await createScope("building");
      await createSeries({ scope: buildingScope, complete: 11 });
      await lifecycle.beginProjectionGeneration({ ...buildingScope, expectedTotal: 1 });
      const blocked = await retention.planRetention({ scope: buildingScope });
      assert.equal(blocked.blockedReason, "BUILDING_PRESENT");
      assert.equal(blocked.candidates.length, 0);
      assert.equal((await retention.applyRetention(blocked)).skippedReason, "BUILDING_PRESENT");

      const errorScope = await createScope("errors");
      await createSeries({ scope: errorScope, errors: 10, listingsPerGeneration: 2, activeOrdinal: null });
      const errorPlan = await retention.planRetention({ scope: errorScope });
      assert.equal(errorPlan.candidates.length, 6);
      assert.equal(errorPlan.candidateListingRows, 12);
      const applied = await retention.applyRetention(errorPlan);
      assert.equal(applied.deletedGenerations, 6);
      assert.equal(applied.deletedListingRows, 12);
      assert.equal(await database.mercadoLivreListingProjection.count({
        where: { organizationId: errorScope.organizationId }
      }), 8);
    });

    await t.test("TOCTOU activation change rejects the stale plan", async () => {
      const scope = await createScope("toctou");
      await createSeries({ scope, complete: 11 });
      const stalePlan = await retention.planRetention({ scope });
      const next = await lifecycle.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
      await lifecycle.stageProjectionListings({
        ...scope,
        generationId: next.generation.id,
        listings: [{
          mlbId: "MLBTOCTOU1",
          title: "Controlled TOCTOU fixture",
          status: "active",
          listingTypeId: "gold_special"
        }]
      });
      await lifecycle.finalizeProjectionGeneration({ ...scope, generationId: next.generation.id });
      await assert.rejects(
        retention.applyRetention(stalePlan),
        (error: unknown) => error instanceof MercadoLivreProjectionRetentionError
          && error.code === "PROJECTION_RETENTION_PLAN_STALE"
      );
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scope.organizationId }
      }), 12);
    });

    await t.test("forced delete failure rolls the entire transaction back", async () => {
      const scope = await createScope("rollback");
      const fixture = await createSeries({ scope, complete: 11, listingsPerGeneration: 2 });
      const plan = await retention.planRetention({ scope });
      const removeTrigger = await installDeleteTrigger({
        stateId: fixture.stateId,
        label: "rollback",
        body: "RAISE EXCEPTION 'controlled retention rollback';"
      });
      try {
        await assert.rejects(retention.applyRetention(plan), /controlled retention rollback/);
      } finally {
        await removeTrigger();
      }
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scope.organizationId }
      }), 11);
      assert.equal(await database.mercadoLivreListingProjection.count({
        where: { organizationId: scope.organizationId }
      }), 22);
      assert.equal((await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { id: fixture.stateId }
      })).activeGenerationId, fixture.activeGenerationId);
    });

    await t.test("retention and lifecycle begin serialize on the same advisory lock", async () => {
      const scope = await createScope("concurrency");
      const fixture = await createSeries({ scope, complete: 11 });
      const plan = await retention.planRetention({ scope });
      const removeTrigger = await installDeleteTrigger({
        stateId: fixture.stateId,
        label: "concurrency",
        body: "PERFORM pg_sleep(0.15);"
      });
      try {
        const applying = retention.applyRetention(plan);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const beginning = lifecycle.beginProjectionGeneration({ ...scope, expectedTotal: 1 });
        const [applied, begun] = await Promise.all([applying, beginning]);
        assert.equal(applied.deletedGenerations, 3);
        assert.equal(begun.generation.status, "BUILDING");
      } finally {
        await removeTrigger();
      }
      const state = await database.mercadoLivreListingProjectionState.findUniqueOrThrow({
        where: { id: fixture.stateId }
      });
      assert.equal(state.activeGenerationId, fixture.activeGenerationId);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { projectionStateId: fixture.stateId, status: "COMPLETE" }
      }), 8);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { projectionStateId: fixture.stateId, status: "BUILDING" }
      }), 1);
    });

    await t.test("100 generations x 100 listings avoid row-by-row cleanup", async () => {
      const scope = await createScope("volume");
      const fixtureStartedAt = performance.now();
      await createSeries({ scope, complete: 100, listingsPerGeneration: 100 });
      const planStartedAt = performance.now();
      const plan = await retention.planRetention({ scope });
      const planDurationMs = performance.now() - planStartedAt;
      assert.equal(plan.candidates.length, 92);
      assert.equal(plan.candidateListingRows, 9_200);
      const applyStartedAt = performance.now();
      const result = await retention.applyRetention(plan);
      const applyDurationMs = performance.now() - applyStartedAt;
      assert.equal(result.deletedGenerations, 92);
      assert.equal(result.deletedListingRows, 9_200);
      assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
        where: { organizationId: scope.organizationId }
      }), 8);
      assert.equal(await database.mercadoLivreListingProjection.count({
        where: { organizationId: scope.organizationId }
      }), 800);
      console.log(JSON.stringify({
        event: "projection_retention_integration_performance",
        fixtureGenerations: 100,
        fixtureListings: 10_000,
        fixtureDurationMs: Math.round(performance.now() - fixtureStartedAt),
        planDurationMs: Math.round(planDurationMs * 100) / 100,
        applyDurationMs: Math.round(applyDurationMs * 100) / 100,
        deletedGenerations: result.deletedGenerations,
        deletedListingRows: result.deletedListingRows
      }));
    });
  } finally {
    for (const organizationId of organizationIds.reverse()) {
      await database.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    }
    await database.$disconnect();
  }
});
