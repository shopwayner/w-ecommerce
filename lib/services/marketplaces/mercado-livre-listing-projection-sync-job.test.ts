import assert from "node:assert/strict";
import test from "node:test";
import {
  processMercadoLivreProjectionSyncJob,
  type MercadoLivreProjectionSyncJobData
} from "./mercado-livre-listing-projection-sync-job";

const job: MercadoLivreProjectionSyncJobData = {
  organizationId: "organization-1",
  marketplaceConnectionId: "connection-1",
  sellerId: "seller-1",
  correlationId: "correlation-1",
  reason: "MANUAL_REFRESH"
};

function completeSync() {
  return {
    status: "COMPLETE" as const,
    generationId: "generation-new",
    expectedTotal: 254,
    storedTotal: 254,
    catalogHash: "catalog-hash",
    catalogPages: 3,
    reconciliationPages: 3,
    detailBatches: 13,
    maxConcurrency: 4,
    durationMs: 100
  };
}

function plan(blockedReason: "BUILDING_PRESENT" | "ACTIVE_GENERATION_INVALID" | null = null) {
  return {
    scope: {
      organizationId: job.organizationId,
      marketplaceConnectionId: job.marketplaceConnectionId,
      sellerId: job.sellerId
    },
    policy: { retainComplete: 8, retainError: 4 },
    stateId: "state-1",
    activeGenerationId: "generation-new",
    totalGenerations: 9,
    completeGenerations: 9,
    errorGenerations: 0,
    buildingGenerations: blockedReason === "BUILDING_PRESENT" ? 1 : 0,
    retainedCompleteGenerationIds: [],
    retainedErrorGenerationIds: [],
    protectedBuildingGenerationIds: [],
    candidates: [],
    candidateListingRows: 0,
    blockedReason,
    fingerprint: "fingerprint"
  };
}

function dependencies(input: {
  enabled?: string;
  fullSync?: () => Promise<ReturnType<typeof completeSync>>;
  planRetention?: () => Promise<ReturnType<typeof plan>>;
  applyRetention?: () => Promise<{
    applied: boolean;
    skippedReason: "BUILDING_PRESENT" | "ACTIVE_GENERATION_INVALID" | null;
    deletedGenerations: number;
    deletedListingRows: number;
    fingerprint: string;
  }>;
}) {
  return {
    environment: input.enabled === undefined
      ? {}
      : { MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: input.enabled },
    fullSyncService: {
      fullSync: input.fullSync ?? (async () => completeSync())
    },
    retentionService: {
      planRetention: input.planRetention ?? (async () => plan()),
      applyRetention: input.applyRetention ?? (async () => ({
        applied: true,
        skippedReason: null,
        deletedGenerations: 0,
        deletedListingRows: 0,
        fingerprint: "fingerprint"
      }))
    }
  };
}

test("flag OFF completes sync without planning or applying retention", async () => {
  let retentionCalls = 0;
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    planRetention: async () => {
      retentionCalls += 1;
      return plan();
    },
    applyRetention: async () => {
      retentionCalls += 1;
      throw new Error("must not run");
    }
  }));
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.retentionOutcome, "SKIPPED_DISABLED");
  assert.equal(result.retentionEnabled, false);
  assert.equal(retentionCalls, 0);
});

for (const scenario of ["first sync", "below limit", "exactly eight after sync"]) {
  test(`${scenario} produces a retention NOOP`, async () => {
    const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
      enabled: "true"
    }));
    assert.equal(result.retentionOutcome, "NOOP");
    assert.equal(result.retentionDeletedGenerations, 0);
    assert.equal(result.retentionDeletedListings, 0);
    assert.equal(result.retentionErrorCode, null);
  });
}

test("8 to 9 COMPLETE generations removes one historical 254-row snapshot", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true",
    applyRetention: async () => ({
      applied: true,
      skippedReason: null,
      deletedGenerations: 1,
      deletedListingRows: 254,
      fingerprint: "fingerprint"
    })
  }));
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.generationId, "generation-new");
  assert.equal(result.retentionOutcome, "APPLIED");
  assert.equal(result.retentionDeletedGenerations, 1);
  assert.equal(result.retentionDeletedListings, 254);
});

test("failed sync never calls retention", async () => {
  let retentionCalls = 0;
  const failure = Object.assign(new Error("controlled sync failure"), {
    code: "PROJECTION_SOURCE_CHANGED"
  });
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true",
    fullSync: async () => { throw failure; },
    planRetention: async () => {
      retentionCalls += 1;
      return plan();
    }
  })), (error: unknown) => error === failure);
  assert.equal(retentionCalls, 0);
});

test("retention failure preserves COMPLETE result and exposes only a safe code", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true",
    applyRetention: async () => {
      throw Object.assign(new Error("sensitive database detail"), {
        code: "PROJECTION_RETENTION_CONCURRENT_OPERATION"
      });
    }
  }));
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.generationId, "generation-new");
  assert.equal(result.retentionOutcome, "FAILED");
  assert.equal(result.retentionErrorCode, "PROJECTION_RETENTION_CONCURRENT_OPERATION");
  assert.doesNotMatch(JSON.stringify(result), /sensitive database detail/);
});

test("the next successful sync naturally recovers deferred cleanup", async () => {
  let applyCalls = 0;
  const deps = dependencies({
    enabled: "true",
    applyRetention: async () => {
      applyCalls += 1;
      if (applyCalls === 1) throw Object.assign(new Error("controlled"), {
        code: "PROJECTION_RETENTION_FAILED"
      });
      return {
        applied: true,
        skippedReason: null,
        deletedGenerations: 2,
        deletedListingRows: 508,
        fingerprint: "fingerprint-next"
      };
    }
  });
  const failedRetention = await processMercadoLivreProjectionSyncJob(job, deps);
  const recovered = await processMercadoLivreProjectionSyncJob({
    ...job,
    correlationId: "correlation-2"
  }, deps);
  assert.equal(failedRetention.retentionOutcome, "FAILED");
  assert.equal(recovered.retentionOutcome, "APPLIED");
  assert.equal(recovered.retentionDeletedGenerations, 2);
  assert.equal(recovered.retentionDeletedListings, 508);
});

test("BUILDING concurrency skips deletion without failing the COMPLETE sync", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true",
    planRetention: async () => plan("BUILDING_PRESENT"),
    applyRetention: async () => ({
      applied: false,
      skippedReason: "BUILDING_PRESENT",
      deletedGenerations: 0,
      deletedListingRows: 0,
      fingerprint: "fingerprint"
    })
  }));
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.retentionOutcome, "SKIPPED_BUILDING");
  assert.equal(result.retentionDeletedGenerations, 0);
});

test("invalid active state fails closed without invalidating the snapshot", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true",
    planRetention: async () => plan("ACTIVE_GENERATION_INVALID"),
    applyRetention: async () => ({
      applied: false,
      skippedReason: "ACTIVE_GENERATION_INVALID",
      deletedGenerations: 0,
      deletedListingRows: 0,
      fingerprint: "fingerprint"
    })
  }));
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.retentionOutcome, "FAILED");
  assert.equal(result.retentionErrorCode, "PROJECTION_RETENTION_ACTIVE_GENERATION_INVALID");
});

test("result telemetry contains only bounded technical retention metadata", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, dependencies({
    enabled: "true"
  }));
  assert.deepEqual(Object.keys(result).filter((key) => key.startsWith("retention")).sort(), [
    "retentionDeletedGenerations",
    "retentionDeletedListings",
    "retentionDurationMs",
    "retentionEnabled",
    "retentionErrorCode",
    "retentionOutcome"
  ]);
  assert.doesNotMatch(JSON.stringify(result), /title|sku|gtin|price|token|payload/i);
});
