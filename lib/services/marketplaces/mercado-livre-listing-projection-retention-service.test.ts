import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_COMPLETE_GENERATIONS,
  MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_ERROR_GENERATIONS,
  parseMercadoLivreProjectionRetentionPolicy
} from "./mercado-livre-listing-projection-retention-config";
import {
  buildMercadoLivreProjectionRetentionPlan,
  MercadoLivreProjectionRetentionError,
  type MercadoLivreProjectionRetentionGeneration
} from "./mercado-livre-listing-projection-retention-service";

const scope = {
  organizationId: "organization-1",
  marketplaceConnectionId: "connection-1",
  sellerId: "seller-1"
};
const base = new Date("2026-08-27T00:00:00.000Z").getTime();

function generation(
  ordinal: number,
  status: "COMPLETE" | "ERROR" | "BUILDING" = "COMPLETE",
  listingCount = 10
): MercadoLivreProjectionRetentionGeneration {
  const timestamp = new Date(base + ordinal * 60_000);
  return {
    id: `generation-${String(ordinal).padStart(3, "0")}`,
    status,
    startedAt: timestamp,
    completedAt: status === "COMPLETE" ? timestamp : null,
    failedAt: status === "ERROR" ? timestamp : null,
    listingCount
  };
}

function plan(input: {
  complete?: number;
  errors?: number;
  building?: number;
  activeOrdinal?: number | null;
  retainComplete?: number;
  retainError?: number;
} = {}) {
  const complete = Array.from({ length: input.complete ?? 0 }, (_, index) => generation(index + 1));
  const errors = Array.from(
    { length: input.errors ?? 0 },
    (_, index) => generation(1_000 + index, "ERROR", 3)
  );
  const building = Array.from(
    { length: input.building ?? 0 },
    (_, index) => generation(2_000 + index, "BUILDING", 4)
  );
  const activeOrdinal = input.activeOrdinal === undefined
    ? complete.length || null
    : input.activeOrdinal;
  return buildMercadoLivreProjectionRetentionPlan({
    scope,
    stateId: "state-1",
    activeGenerationId: activeOrdinal ? generation(activeOrdinal).id : null,
    policy: {
      retainComplete: input.retainComplete ?? 8,
      retainError: input.retainError ?? 4
    },
    generations: [...complete, ...errors, ...building]
  });
}

test("retention configuration uses centralized safe defaults", () => {
  assert.deepEqual(parseMercadoLivreProjectionRetentionPolicy({}), {
    retainComplete: 8,
    retainError: 4
  });
  for (const invalid of ["0", "-1", "1.5", "invalid", "10001"]) {
    assert.deepEqual(parseMercadoLivreProjectionRetentionPolicy({
      MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS: invalid,
      MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS: invalid
    }), {
      retainComplete: MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_COMPLETE_GENERATIONS,
      retainError: MERCADO_LIVRE_PROJECTION_RETENTION_DEFAULT_ERROR_GENERATIONS
    });
  }
  assert.deepEqual(parseMercadoLivreProjectionRetentionPolicy({
    MERCADO_LIVRE_PROJECTION_RETENTION_COMPLETE_GENERATIONS: "12",
    MERCADO_LIVRE_PROJECTION_RETENTION_ERROR_GENERATIONS: "6"
  }), { retainComplete: 12, retainError: 6 });
});

for (const count of [0, 1, 4, 7, 8]) {
  test(`${count} COMPLETE generations remain under the retention limit`, () => {
    const result = plan({ complete: count });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.candidateListingRows, 0);
  });
}

for (const [count, deleted] of [[9, 1], [11, 3], [100, 92]] as const) {
  test(`${count} COMPLETE generations retain exactly eight and delete ${deleted}`, () => {
    const result = plan({ complete: count });
    assert.equal(result.retainedCompleteGenerationIds.length, 8);
    assert.equal(result.candidates.length, deleted);
    assert.equal(result.candidateListingRows, deleted * 10);
    assert.ok(!result.candidates.some(({ generationId }) => (
      generationId === result.activeGenerationId
    )));
  });
}

test("an old active generation is protected and included inside the limit", () => {
  const result = plan({ complete: 11, activeOrdinal: 1 });
  assert.equal(result.retainedCompleteGenerationIds.length, 8);
  assert.ok(result.retainedCompleteGenerationIds.includes(generation(1).id));
  assert.ok(!result.candidates.some(({ generationId }) => generationId === generation(1).id));
  assert.deepEqual(
    result.candidates.map(({ generationId }) => generationId),
    [generation(4).id, generation(3).id, generation(2).id]
  );
});

test("BUILDING blocks the complete scope and remains protected", () => {
  const result = plan({ complete: 11, building: 1 });
  assert.equal(result.blockedReason, "BUILDING_PRESENT");
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.protectedBuildingGenerationIds, [generation(2_000, "BUILDING").id]);
});

test("ERROR retention keeps four and includes partial listing rows in candidates", () => {
  const result = plan({ errors: 10, activeOrdinal: null });
  assert.equal(result.retainedErrorGenerationIds.length, 4);
  assert.equal(result.candidates.length, 6);
  assert.equal(result.candidateListingRows, 18);
  assert.ok(result.candidates.every(({ status }) => status === "ERROR"));
});

test("invalid or unknown active states fail closed", () => {
  const completeWithoutActive = plan({ complete: 2, activeOrdinal: null });
  assert.equal(completeWithoutActive.blockedReason, "ACTIVE_GENERATION_INVALID");
  assert.equal(completeWithoutActive.candidates.length, 0);
  assert.throws(
    () => buildMercadoLivreProjectionRetentionPlan({
      scope,
      stateId: "state-1",
      activeGenerationId: null,
      policy: { retainComplete: 8, retainError: 4 },
      generations: [{ ...generation(1), status: "FUTURE_STATUS" }]
    }),
    (error: unknown) => error instanceof MercadoLivreProjectionRetentionError
      && error.code === "PROJECTION_RETENTION_STATUS_UNKNOWN"
  );
});

test("plan output contains technical metadata only", () => {
  const serialized = JSON.stringify(plan({ complete: 11, errors: 6 }));
  assert.doesNotMatch(serialized, /title|sku|gtin|price|token|payload/i);
});

test("retention reuses lifecycle lock semantics and has no automatic wiring", async () => {
  const [retention, lifecycle, worker, scheduler] = await Promise.all([
    readFile("lib/services/marketplaces/mercado-livre-listing-projection-retention-service.ts", "utf8"),
    readFile("lib/services/marketplaces/mercado-livre-listing-projection-service.ts", "utf8"),
    readFile("lib/services/marketplaces/mercado-livre-listing-projection-bullmq.ts", "utf8"),
    readFile("lib/services/marketplaces/mercado-livre-listing-projection-scheduler.ts", "utf8")
  ]);
  for (const source of [retention, lifecycle]) {
    assert.match(source, /"mercado-livre-listing-projection"/);
    assert.match(source, /pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)::text/);
  }
  assert.doesNotMatch(worker, /ProjectionRetention|planRetention|applyRetention/);
  assert.doesNotMatch(scheduler, /ProjectionRetention|planRetention|applyRetention/);
  assert.doesNotMatch(retention, /fetch\(|OAuth|BullMQ|setInterval|cron/i);
});
