import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMercadoLivreProjectionWorkerTargetAllowlisted,
  MercadoLivreProjectionRuntimeConfigurationError,
  MercadoLivreProjectionWorkerTargetNotAllowedError,
  parseMercadoLivreProjectionRuntimeConfig
} from "./mercado-livre-listing-projection-runtime-config";

const target = {
  organizationId: "organization-runtime",
  marketplaceConnectionId: "connection-runtime",
  sellerId: "seller-runtime"
};

function environment(overrides: Record<string, string> = {}) {
  return {
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: "true",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: JSON.stringify([target]),
    MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES: "15",
    MERCADO_LIVRE_PROJECTION_STALE_AFTER_MINUTES: "30",
    ...overrides
  };
}

test("persistent runtime accepts exactly one complete allowlisted target", () => {
  const config = parseMercadoLivreProjectionRuntimeConfig(environment());
  assert.equal(config.targets.length, 1);
  assert.equal(config.workerEnabled, true);
  assert.equal(config.schedulerEnabled, true);
  assert.equal(config.retentionEnabled, true);
});

test("persistent runtime fails closed for zero or more than one target", () => {
  for (const targets of [[], [target, { ...target, sellerId: "seller-two" }]]) {
    assert.throws(
      () => parseMercadoLivreProjectionRuntimeConfig(environment({
        MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: JSON.stringify(targets)
      })),
      (error: unknown) => error instanceof MercadoLivreProjectionRuntimeConfigurationError
    );
  }
});

test("persistent runtime rejects malformed flags, targets and cadence", () => {
  assert.throws(() => parseMercadoLivreProjectionRuntimeConfig(environment({
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "yes"
  })), /FLAG_INVALID/);
  assert.throws(() => parseMercadoLivreProjectionRuntimeConfig(environment({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "not-json"
  })), /TARGETS_INVALID/);
  assert.throws(() => parseMercadoLivreProjectionRuntimeConfig(environment({
    MERCADO_LIVRE_PROJECTION_SCHEDULER_INTERVAL_MINUTES: "0"
  })), /INTERVAL_INVALID/);
});

test("worker allowlist is an exact organization, connection and seller match", () => {
  assert.doesNotThrow(() => assertMercadoLivreProjectionWorkerTargetAllowlisted(
    target,
    [target]
  ));
  for (const job of [
    { ...target, organizationId: "other-organization" },
    { ...target, marketplaceConnectionId: "other-connection" },
    { ...target, sellerId: "other-seller" }
  ]) {
    assert.throws(
      () => assertMercadoLivreProjectionWorkerTargetAllowlisted(job, [target]),
      MercadoLivreProjectionWorkerTargetNotAllowedError
    );
  }
});

test("disabled dark defaults do not require a target", () => {
  const config = parseMercadoLivreProjectionRuntimeConfig({
    MERCADO_LIVRE_PROJECTION_WORKER_ENABLED: "false",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_ENABLED: "false",
    MERCADO_LIVRE_PROJECTION_RETENTION_ENABLED: "false",
    MERCADO_LIVRE_PROJECTION_SCHEDULER_TARGETS: "[]"
  });
  assert.equal(config.targets.length, 0);
});
