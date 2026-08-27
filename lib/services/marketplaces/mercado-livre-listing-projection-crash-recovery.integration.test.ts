import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { MercadoLivreListingProjectionService } from "./mercado-livre-listing-projection-service";

const databaseUrl = process.env.ML_PROJECTION_FULL_SYNC_TEST_DATABASE_URL;

test("recovery lifecycle binds an explicit generation ID to one exact scope", {
  skip: databaseUrl ? false : "Disposable PostgreSQL URL is not configured"
}, async () => {
  assert.ok(databaseUrl);
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const lifecycle = new MercadoLivreListingProjectionService(database);
  const organizationIds: string[] = [];

  async function scope(suffix: string) {
    const organization = await database.organization.create({
      data: { name: `Crash recovery ${suffix}`, slug: `crash-recovery-${suffix}-${Date.now()}` }
    });
    organizationIds.push(organization.id);
    const sellerId = `seller-${suffix}`;
    const connection = await database.marketplaceConnection.create({
      data: {
        organizationId: organization.id,
        provider: "MERCADOLIVRE",
        accountAlias: `ML ${suffix}`,
        status: "ACTIVE",
        configStatus: "READY",
        sellerId
      }
    });
    return {
      organizationId: organization.id,
      marketplaceConnectionId: connection.id,
      sellerId
    };
  }

  try {
    const scopeA = await scope("a");
    const scopeB = await scope("b");
    const generationId = "mlpr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const begun = await lifecycle.beginProjectionGeneration({
      ...scopeA,
      generationId,
      expectedTotal: 2
    });
    assert.equal(begun.generation.id, generationId);
    assert.deepEqual(await lifecycle.inspectProjectionGeneration({
      ...scopeA,
      generationId
    }), {
      generationId,
      status: "BUILDING",
      expectedTotal: 2,
      storedTotal: 0,
      activeGenerationId: null
    });

    await assert.rejects(
      lifecycle.inspectProjectionGeneration({ ...scopeB, generationId }),
      (error: unknown) => error instanceof Error
        && "code" in error
        && error.code === "PROJECTION_RECOVERY_SCOPE_MISMATCH"
    );
    assert.equal((await database.mercadoLivreListingProjectionGeneration.findUniqueOrThrow({
      where: { id: generationId }
    })).status, "BUILDING");

    await lifecycle.failProjectionGeneration({
      ...scopeA,
      generationId,
      errorCode: "PROJECTION_STALLED_JOB_ABORTED",
      errorSummary: "Projection worker was lost while building this generation."
    });
    const failed = await lifecycle.inspectProjectionGeneration({ ...scopeA, generationId });
    assert.equal(failed?.status, "ERROR");
    assert.equal((await lifecycle.getProjectionReadiness(scopeA)).readiness, "ERROR_WITHOUT_SNAPSHOT");
    assert.equal(await database.mercadoLivreListingProjectionGeneration.count({
      where: { ...scopeA, status: "BUILDING" }
    }), 0);
  } finally {
    if (organizationIds.length > 0) {
      await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    }
    await database.$disconnect();
  }
});
