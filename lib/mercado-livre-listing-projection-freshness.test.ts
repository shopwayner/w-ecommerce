import assert from "node:assert/strict";
import test from "node:test";
import {
  createMercadoLivreProjectionFreshnessPolicy,
  getMercadoLivreProjectionCadenceSlot,
  getMercadoLivreProjectionFreshness,
  isMercadoLivreProjectionSyncDue
} from "./mercado-livre-listing-projection-freshness";

const now = new Date("2026-08-26T15:00:00.000Z");
const policy = createMercadoLivreProjectionFreshnessPolicy();

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function complete(minutes: number) {
  return {
    status: "COMPLETE" as const,
    expectedTotal: 254,
    storedTotal: 254,
    completedAt: minutesAgo(minutes),
    failedAt: null
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    now,
    stateStatus: "COMPLETE" as const,
    activeGeneration: complete(1),
    lastSuccessfulSyncAt: minutesAgo(1),
    lastAttemptFinishedAt: minutesAgo(1),
    hasBuildingGeneration: false,
    policy,
    ...overrides
  };
}

test("freshness defaults centralize a 15 minute cadence and 30 minute stale threshold", () => {
  assert.deepEqual(policy, { cadenceMs: 900_000, staleAfterMs: 1_800_000 });
});

test("no valid active generation is NO_SNAPSHOT and due", () => {
  const value = input({
    stateStatus: null,
    activeGeneration: null,
    lastSuccessfulSyncAt: null,
    lastAttemptFinishedAt: null
  });
  assert.equal(getMercadoLivreProjectionFreshness(value), "NO_SNAPSHOT");
  assert.equal(isMercadoLivreProjectionSyncDue(value), true);
});

for (const minutes of [1, 14 + 59 / 60]) {
  test(`snapshot ${minutes} minutes old stays fresh and is not due`, () => {
    const value = input({
      activeGeneration: complete(minutes),
      lastSuccessfulSyncAt: minutesAgo(minutes),
      lastAttemptFinishedAt: minutesAgo(minutes)
    });
    assert.equal(getMercadoLivreProjectionFreshness(value), "FRESH");
    assert.equal(isMercadoLivreProjectionSyncDue(value), false);
  });
}

for (const minutes of [15, 20]) {
  test(`snapshot ${minutes} minutes old is due but not stale`, () => {
    const value = input({
      activeGeneration: complete(minutes),
      lastSuccessfulSyncAt: minutesAgo(minutes),
      lastAttemptFinishedAt: minutesAgo(minutes)
    });
    assert.equal(getMercadoLivreProjectionFreshness(value), "FRESH");
    assert.equal(isMercadoLivreProjectionSyncDue(value), true);
  });
}

for (const minutes of [30, 120]) {
  test(`snapshot ${minutes} minutes old is stale and due once`, () => {
    const value = input({
      activeGeneration: complete(minutes),
      lastSuccessfulSyncAt: minutesAgo(minutes),
      lastAttemptFinishedAt: minutesAgo(minutes)
    });
    assert.equal(getMercadoLivreProjectionFreshness(value), "STALE");
    assert.equal(isMercadoLivreProjectionSyncDue(value), true);
  });
}

test("BUILDING takes freshness priority and blocks enqueue with an active snapshot", () => {
  const value = input({ stateStatus: "SYNCING", hasBuildingGeneration: true });
  assert.equal(getMercadoLivreProjectionFreshness(value), "SYNCING");
  assert.equal(isMercadoLivreProjectionSyncDue(value), false);
});

test("ERROR with an active snapshot remains usable but waits for the next cadence", () => {
  const value = input({
    stateStatus: "ERROR",
    activeGeneration: complete(120),
    lastSuccessfulSyncAt: minutesAgo(120),
    lastAttemptFinishedAt: minutesAgo(1)
  });
  assert.equal(getMercadoLivreProjectionFreshness(value), "ERROR_WITH_SNAPSHOT");
  assert.equal(isMercadoLivreProjectionSyncDue(value), false);
});

test("ERROR without a snapshot is fail closed against immediate retry", () => {
  const value = input({
    stateStatus: "ERROR",
    activeGeneration: null,
    lastSuccessfulSyncAt: null,
    lastAttemptFinishedAt: minutesAgo(1)
  });
  assert.equal(getMercadoLivreProjectionFreshness(value), "ERROR_NO_SNAPSHOT");
  assert.equal(isMercadoLivreProjectionSyncDue(value), false);
  assert.equal(isMercadoLivreProjectionSyncDue({
    ...value,
    lastAttemptFinishedAt: minutesAgo(15)
  }), true);
});

test("cadence slots change only at the exact boundary", () => {
  const slot = getMercadoLivreProjectionCadenceSlot(now, policy.cadenceMs);
  assert.equal(
    getMercadoLivreProjectionCadenceSlot(new Date(now.getTime() - 1), policy.cadenceMs),
    slot - 1
  );
});

test("invalid temporal policy is rejected", () => {
  assert.throws(() => createMercadoLivreProjectionFreshnessPolicy({ cadenceMinutes: 0 }));
  assert.throws(() => createMercadoLivreProjectionFreshnessPolicy({ cadenceMinutes: 31 }));
  assert.throws(() => createMercadoLivreProjectionFreshnessPolicy({ staleAfterMinutes: 0 }));
});
