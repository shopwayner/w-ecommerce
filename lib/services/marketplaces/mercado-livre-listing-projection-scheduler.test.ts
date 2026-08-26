import assert from "node:assert/strict";
import test from "node:test";
import {
  createMercadoLivreProjectionFreshnessPolicy
} from "@/lib/mercado-livre-listing-projection-freshness";
import {
  isMercadoLivreProjectionSchedulerEnabled,
  parseMercadoLivreProjectionSchedulerConfig,
  MercadoLivreProjectionSchedulerConfigurationError,
  type MercadoLivreProjectionSchedulerTarget
} from "./mercado-livre-listing-projection-scheduler-config";
import {
  MercadoLivreProjectionScheduler,
  type MercadoLivreProjectionSchedulerQueue,
  type MercadoLivreProjectionSchedulerRepository
} from "./mercado-livre-listing-projection-scheduler";

const target: MercadoLivreProjectionSchedulerTarget = {
  organizationId: "organization-1",
  marketplaceConnectionId: "connection-1",
  sellerId: "seller-1"
};
const now = new Date("2026-08-26T15:00:00.000Z");

function complete(minutesAgo: number) {
  return {
    id: "generation-active",
    status: "COMPLETE" as const,
    expectedTotal: 254,
    storedTotal: 254,
    completedAt: new Date(now.getTime() - minutesAgo * 60_000),
    failedAt: null
  };
}

function dependencies(input: {
  enabled?: boolean;
  allowlist?: MercadoLivreProjectionSchedulerTarget[];
  connection?: Partial<Awaited<ReturnType<MercadoLivreProjectionSchedulerRepository["getConnection"]>>> | null;
  snapshotMinutes?: number;
  stateStatus?: "NEVER_SYNCED" | "SYNCING" | "COMPLETE" | "ERROR" | null;
  lastAttemptMinutes?: number | null;
  building?: boolean;
  pending?: boolean;
} = {}) {
  const calls = { enqueued: 0, closed: 0 };
  const snapshotMinutes = input.snapshotMinutes ?? 15;
  const connection = input.connection === null ? null : {
    provider: "MERCADOLIVRE",
    status: "ACTIVE",
    configStatus: "READY",
    sellerId: target.sellerId,
    ...input.connection
  };
  const repository: MercadoLivreProjectionSchedulerRepository = {
    async getConnection() { return connection; },
    async getProjectionState() {
      return {
        stateStatus: input.stateStatus === undefined ? "COMPLETE" : input.stateStatus,
        activeGeneration: complete(snapshotMinutes),
        lastSuccessfulSyncAt: complete(snapshotMinutes).completedAt,
        lastAttemptFinishedAt: input.lastAttemptMinutes === null
          ? null
          : new Date(now.getTime() - (input.lastAttemptMinutes ?? snapshotMinutes) * 60_000),
        hasBuildingGeneration: input.building ?? false
      };
    }
  };
  const queue: MercadoLivreProjectionSchedulerQueue = {
    async hasPendingJob() { return input.pending ?? false; },
    async enqueue({ slot }) {
      calls.enqueued += 1;
      return { id: `job-${slot}` };
    },
    async close() { calls.closed += 1; }
  };
  const scheduler = new MercadoLivreProjectionScheduler({
    config: {
      enabled: input.enabled ?? true,
      policy: createMercadoLivreProjectionFreshnessPolicy(),
      targets: input.allowlist ?? [target],
      tickMs: 60_000
    },
    repository,
    queue,
    now: () => now
  });
  return { scheduler, calls };
}

test("scheduler flag is literal true only and targets default empty", () => {
  assert.equal(isMercadoLivreProjectionSchedulerEnabled({}), false);
  assert.equal(isMercadoLivreProjectionSchedulerEnabled({ MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "TRUE" }), false);
  assert.equal(isMercadoLivreProjectionSchedulerEnabled({ MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true" }), true);
  const disabled = parseMercadoLivreProjectionSchedulerConfig({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "invalid",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "not parsed while disabled"
  });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.targets, []);
  const enabled = parseMercadoLivreProjectionSchedulerConfig({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "[]"
  });
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.targets, []);
});

test("allowlist requires an exact tenant, connection and seller triple", () => {
  const parsed = parseMercadoLivreProjectionSchedulerConfig({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: JSON.stringify([target])
  });
  assert.deepEqual(parsed.targets, [target]);
  for (const invalid of [
    [{ organizationId: "organization-1", sellerId: "seller-1" }],
    [{ ...target, token: "forbidden" }],
    [target, target]
  ]) {
    assert.throws(
      () => parseMercadoLivreProjectionSchedulerConfig({
        MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
        MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: JSON.stringify(invalid)
      }),
      (error: unknown) => error instanceof MercadoLivreProjectionSchedulerConfigurationError
    );
  }
});

test("disabled and non-allowlisted targets are skipped before database access", async () => {
  assert.equal((await dependencies({ enabled: false }).scheduler.evaluateTarget(target)).decision, "SKIP_DISABLED");
  assert.equal((await dependencies({ allowlist: [] }).scheduler.evaluateTarget(target)).decision, "SKIP_NOT_ALLOWLISTED");
});

for (const [label, connection] of [
  ["missing", null],
  ["provider", { provider: "AMAZON" }],
  ["status", { status: "DISABLED" }],
  ["config", { configStatus: "MISSING" }],
  ["seller", { sellerId: "other-seller" }]
] as const) {
  test(`${label} connection mismatch fails closed`, async () => {
    assert.equal(
      (await dependencies({ connection }).scheduler.evaluateTarget(target)).decision,
      "SKIP_CONNECTION_NOT_READY"
    );
  });
}

test("recent snapshots are skipped while due and stale snapshots enqueue once", async () => {
  assert.equal(
    (await dependencies({ snapshotMinutes: 14 }).scheduler.evaluateTarget(target)).decision,
    "SKIP_NOT_DUE"
  );
  const due = dependencies({ snapshotMinutes: 15 });
  const dueResult = await due.scheduler.evaluateTarget(target);
  assert.equal(dueResult.decision, "ENQUEUED");
  assert.equal(dueResult.freshness, "FRESH");
  assert.equal(due.calls.enqueued, 1);
  const stale = dependencies({ snapshotMinutes: 120 });
  const staleResult = await stale.scheduler.evaluateTarget(target);
  assert.equal(staleResult.decision, "ENQUEUED");
  assert.equal(staleResult.freshness, "STALE");
  assert.equal(stale.calls.enqueued, 1, "missed runs must not create catch-up bursts");
});

test("BUILDING and existing waiting/active/delayed work are independent barriers", async () => {
  assert.equal(
    (await dependencies({ building: true, stateStatus: "SYNCING" }).scheduler.evaluateTarget(target)).decision,
    "SKIP_BUILDING"
  );
  assert.equal(
    (await dependencies({ pending: true }).scheduler.evaluateTarget(target)).decision,
    "SKIP_JOB_EXISTS"
  );
});

test("ERROR states wait one cadence before another attempt", async () => {
  assert.equal((await dependencies({
    stateStatus: "ERROR",
    snapshotMinutes: 120,
    lastAttemptMinutes: 1
  }).scheduler.evaluateTarget(target)).decision, "SKIP_NOT_DUE");
  assert.equal((await dependencies({
    stateStatus: "ERROR",
    snapshotMinutes: 120,
    lastAttemptMinutes: 15
  }).scheduler.evaluateTarget(target)).decision, "ENQUEUED");
});

test("configuration rejects invalid cadence and stale thresholds", () => {
  for (const env of [
    { MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES: "0" },
    { MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES: "abc" },
    {
      MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES: "31",
      MERCADO_LIVRE_PROJECTION_STALE_AFTER_MINUTES: "30"
    }
  ]) {
    assert.throws(() => parseMercadoLivreProjectionSchedulerConfig({
      MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
      MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "[]",
      ...env
    }));
  }
});
