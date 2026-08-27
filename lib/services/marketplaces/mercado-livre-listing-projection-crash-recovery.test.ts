import assert from "node:assert/strict";
import test from "node:test";
import {
  MercadoLivreProjectionJobRecoveryError,
  processMercadoLivreProjectionSyncJob,
  type MercadoLivreProjectionRecoveryContext,
  type MercadoLivreProjectionSyncJobData
} from "./mercado-livre-listing-projection-sync-job";

const job: MercadoLivreProjectionSyncJobData = {
  organizationId: "organization-1",
  marketplaceConnectionId: "connection-1",
  sellerId: "seller-1",
  correlationId: "correlation-safe",
  reason: "PERIODIC_RECONCILIATION"
};

const generationId = "mlpr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function recovery(recoveryDetected: boolean): MercadoLivreProjectionRecoveryContext {
  return {
    generationId,
    recoveryDetected,
    stalledCounter: recoveryDetected ? 1 : 0,
    attemptsStarted: recoveryDetected ? 2 : 1,
    attemptsMade: 0
  };
}

function complete(generation = generationId) {
  return {
    status: "COMPLETE" as const,
    generationId: generation,
    expectedTotal: 2,
    storedTotal: 2,
    catalogHash: "safe-hash",
    catalogPages: 1,
    reconciliationPages: 1,
    detailBatches: 1,
    maxConcurrency: 1,
    durationMs: 10
  };
}

function retained(deletedGenerations = 0) {
  return {
    planRetention: async () => ({}) as never,
    applyRetention: async () => ({
      applied: true,
      skippedReason: null,
      deletedGenerations,
      deletedListingRows: deletedGenerations * 2,
      fingerprint: "safe-fingerprint"
    })
  };
}

function service(input: {
  previous?: null | {
    status: "BUILDING" | "COMPLETE" | "ERROR";
    expectedTotal?: number | null;
    storedTotal?: number;
  };
  inspectError?: unknown;
  fullSync?: () => Promise<ReturnType<typeof complete>>;
  onAbort?: () => void;
}) {
  return {
    async inspectRecoveryGeneration() {
      if (input.inspectError) throw input.inspectError;
      if (!input.previous) return null;
      return {
        generationId,
        status: input.previous.status,
        expectedTotal: input.previous.expectedTotal ?? 2,
        storedTotal: input.previous.storedTotal ?? 2,
        activeGenerationId: input.previous.status === "COMPLETE" ? generationId : "previous-active"
      };
    },
    async abortRecoveryGeneration() {
      input.onAbort?.();
      return {
        generationId,
        status: "ERROR" as const,
        errorCode: "PROJECTION_STALLED_JOB_ABORTED",
        idempotent: false
      };
    },
    fullSync: input.fullSync ?? (async () => complete())
  };
}

test("first execution starts one explicit generation after recovery state is absent", async () => {
  let receivedGenerationId: string | undefined;
  const result = await processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      fullSync: async (...args: unknown[]) => {
        receivedGenerationId = (args[0] as { recoveryGenerationId?: string }).recoveryGenerationId;
        return complete();
      }
    }),
    options: { recovery: recovery(false) }
  });
  assert.equal(receivedGenerationId, generationId);
  assert.equal(result.syncOutcome, "NORMAL_EXECUTION");
  assert.equal(result.recoveryDetected, false);
});

test("stalled replay before begin reuses exactly the persisted generation ID", async () => {
  let fullSyncCalls = 0;
  const result = await processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    options: { recovery: recovery(true) }
  });
  assert.equal(fullSyncCalls, 1);
  assert.equal(result.generationId, generationId);
  assert.equal(result.syncOutcome, "RECOVERED_BEFORE_BEGIN");
});

test("stalled BUILDING replay marks only that generation ERROR and fails terminally", async () => {
  let aborted = 0;
  let fullSyncCalls = 0;
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      previous: { status: "BUILDING", storedTotal: 1 },
      onAbort: () => { aborted += 1; },
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    options: { recovery: recovery(true) }
  }), (error: unknown) => error instanceof MercadoLivreProjectionJobRecoveryError
    && error.code === "PROJECTION_STALLED_JOB_ABORTED");
  assert.equal(aborted, 1);
  assert.equal(fullSyncCalls, 0);
});

test("a first execution never aborts an unrelated legitimate BUILDING generation", async () => {
  let aborted = 0;
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      previous: { status: "BUILDING" },
      onAbort: () => { aborted += 1; }
    }),
    options: { recovery: recovery(false) }
  }), (error: unknown) => error instanceof MercadoLivreProjectionJobRecoveryError
    && error.code === "PROJECTION_RECOVERY_SIGNAL_REQUIRED");
  assert.equal(aborted, 0);
});

test("COMPLETE replay skips full sync and reruns retention idempotently", async () => {
  let fullSyncCalls = 0;
  const result = await processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      previous: { status: "COMPLETE" },
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    retentionService: retained(1),
    environment: { MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: "true" },
    options: { recovery: recovery(true) }
  });
  assert.equal(fullSyncCalls, 0);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.syncOutcome, "RECOVERED_COMPLETE_RETENTION_APPLIED");
  assert.equal(result.retentionOutcome, "APPLIED");
});

test("COMPLETE replay with retention disabled completes without a new sync", async () => {
  let fullSyncCalls = 0;
  const result = await processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      previous: { status: "COMPLETE" },
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    options: { recovery: recovery(true) }
  });
  assert.equal(fullSyncCalls, 0);
  assert.equal(result.syncOutcome, "RECOVERED_ALREADY_COMPLETE");
  assert.equal(result.retentionOutcome, "SKIPPED_DISABLED");
});

test("ERROR replay is terminal and never starts another full sync", async () => {
  let fullSyncCalls = 0;
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      previous: { status: "ERROR" },
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    options: { recovery: recovery(true) }
  }), (error: unknown) => error instanceof MercadoLivreProjectionJobRecoveryError
    && error.code === "PROJECTION_RECOVERY_GENERATION_ERROR");
  assert.equal(fullSyncCalls, 0);
});

test("scope mismatch fails closed before full sync, abort or retention", async () => {
  let fullSyncCalls = 0;
  const mismatch = Object.assign(new Error("safe mismatch"), {
    code: "PROJECTION_RECOVERY_SCOPE_MISMATCH"
  });
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({
      inspectError: mismatch,
      fullSync: async () => {
        fullSyncCalls += 1;
        return complete();
      }
    }),
    options: { recovery: recovery(true) }
  }), (error: unknown) => error === mismatch);
  assert.equal(fullSyncCalls, 0);
});

test("direct processing without BullMQ recovery state preserves the old flow", async () => {
  const result = await processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: { fullSync: async () => complete("direct-generation") }
  });
  assert.equal(result.generationId, "direct-generation");
  assert.equal(result.syncOutcome, "NORMAL_EXECUTION");
  assert.equal(result.recoveryGenerationId, null);
});

test("recovery telemetry remains technical and never exposes listing data", async () => {
  const telemetry: unknown[] = [];
  await assert.rejects(processMercadoLivreProjectionSyncJob(job, {
    fullSyncService: service({ previous: { status: "BUILDING", storedTotal: 1 } }),
    options: {
      recovery: recovery(true),
      onTelemetry: (event) => telemetry.push(event)
    }
  }));
  assert.equal(telemetry.length, 1);
  assert.match(JSON.stringify(telemetry[0]), /RECOVERED_BUILDING_ABORTED/);
  assert.doesNotMatch(JSON.stringify(telemetry[0]), /sku|gtin|title|token|authorization|bearer/i);
});
