import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  canActivateMercadoLivreProjectionGeneration,
  getMercadoLivreProjectionReadiness,
  sanitizeMercadoLivreProjectionError
} from "./mercado-livre-listing-projection";

const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");

function modelSource(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} must exist in the Prisma schema`);
  return match[0];
}

test("projection schema preserves nullable unknown stock without a zero default", () => {
  const projection = modelSource("MercadoLivreListingProjection");
  assert.match(projection, /availableQuantity\s+Int\?/);
  assert.doesNotMatch(projection, /availableQuantity[^\n]*@default\(0\)/);
});

test("projection identity and state uniqueness stay tenant-aware", () => {
  const state = modelSource("MercadoLivreListingProjectionState");
  const generation = modelSource("MercadoLivreListingProjectionGeneration");
  const projection = modelSource("MercadoLivreListingProjection");

  assert.match(state, /@@unique\(\[organizationId, marketplaceConnectionId, sellerId\]/);
  assert.match(state, /fields: \[marketplaceConnectionId, organizationId\], references: \[id, organizationId\]/);
  assert.match(generation, /projectionStateId, organizationId, marketplaceConnectionId, sellerId/);
  assert.match(projection, /generationId, organizationId, marketplaceConnectionId, sellerId/);
  assert.match(projection, /@@unique\(\[generationId, mlbId\]/);
});

test("projection is linked to the modern MarketplaceConnection and stores no credentials", () => {
  const state = modelSource("MercadoLivreListingProjectionState");
  const projectionModels = [
    state,
    modelSource("MercadoLivreListingProjectionGeneration"),
    modelSource("MercadoLivreListingProjection")
  ].join("\n");

  assert.match(state, /marketplaceConnection\s+MarketplaceConnection/);
  assert.doesNotMatch(state, /MercadoLivreConnection\s+@relation/);
  assert.doesNotMatch(projectionModels, /accessToken|refreshToken|Authorization|apiKey|secret/i);
  assert.doesNotMatch(projectionModels, /rawJson|rawPayload|metadata/);
});

test("BUILDING and ERROR generations are not activation candidates", () => {
  for (const status of ["BUILDING", "ERROR"] as const) {
    assert.equal(canActivateMercadoLivreProjectionGeneration({
      status,
      expectedTotal: 1,
      storedTotal: 1,
      completedAt: new Date(),
      failedAt: status === "ERROR" ? new Date() : null
    }), false);
  }
});

test("COMPLETE generation without coherent totals is not activatable", () => {
  const base = { status: "COMPLETE" as const, storedTotal: 2, completedAt: new Date(), failedAt: null };
  assert.equal(canActivateMercadoLivreProjectionGeneration({ ...base, expectedTotal: null }), false);
  assert.equal(canActivateMercadoLivreProjectionGeneration({ ...base, expectedTotal: 3 }), false);
  assert.equal(canActivateMercadoLivreProjectionGeneration({ ...base, expectedTotal: -1 }), false);
  assert.equal(canActivateMercadoLivreProjectionGeneration({ ...base, expectedTotal: 2, completedAt: null }), false);
  assert.equal(canActivateMercadoLivreProjectionGeneration({ ...base, expectedTotal: 2, failedAt: new Date() }), false);
});

test("coherent COMPLETE generation can become an activation candidate", () => {
  assert.equal(canActivateMercadoLivreProjectionGeneration({
    status: "COMPLETE",
    expectedTotal: 2,
    storedTotal: 2,
    completedAt: new Date(),
    failedAt: null
  }), true);
});

test("readiness distinguishes every persisted state with and without an active snapshot", () => {
  const complete = {
    status: "COMPLETE" as const,
    expectedTotal: 1,
    storedTotal: 1,
    completedAt: new Date(),
    failedAt: null
  };
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: null,
    activeGeneration: null
  }), "NEVER_SYNCED");
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: "SYNCING",
    activeGeneration: null
  }), "SYNCING_WITHOUT_SNAPSHOT");
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: "SYNCING",
    activeGeneration: complete
  }), "SYNCING_WITH_ACTIVE_SNAPSHOT");
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: "COMPLETE",
    activeGeneration: complete
  }), "READY");
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: "ERROR",
    activeGeneration: null
  }), "ERROR_WITHOUT_SNAPSHOT");
  assert.equal(getMercadoLivreProjectionReadiness({
    stateStatus: "ERROR",
    activeGeneration: complete
  }), "ERROR_WITH_ACTIVE_SNAPSHOT");
});

test("projection errors are stable, bounded and redact credential-shaped data", () => {
  const sanitized = sanitizeMercadoLivreProjectionError(
    "provider secret=private-code failure / 503",
    `Authorization=secret Bearer token-value access_token=hidden ${"x".repeat(300)}`
  );
  assert.equal(sanitized.code, "PROVIDER_SECRET_REDACTED_FAILURE_503");
  assert.ok(sanitized.code.length <= 80);
  assert.ok(sanitized.summary.length <= 240);
  assert.doesNotMatch(sanitized.code, /PRIVATE_CODE/);
  assert.doesNotMatch(sanitized.summary, /secret|token-value|hidden/);
  assert.match(sanitized.summary, /\[REDACTED\]/);
});
