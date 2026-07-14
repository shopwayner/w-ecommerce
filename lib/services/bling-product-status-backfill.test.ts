import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBlingProductStatusConditionalUpdate,
  classifyBlingProductStatusConditionalUpdate,
  mergeBlingProductStatusAttributes,
  normalizeBlingProductStatus,
  readCanonicalBlingStatusFromAttributes
} from "./bling-product-import-service";

const originalUpdatedAt = new Date("2026-07-14T12:34:56.789Z");
const statusCheckedAt = "2026-07-14T13:00:00.000Z";

const existingAttributes = {
  color: "blue",
  nested: { preserved: true },
  bling: {
    externalProductId: "12345",
    connectionId: "connection-123",
    source: "CATALOG_READ",
    customMetadata: "keep",
    status: "UNKNOWN",
    externalStatus: null,
    statusCheckedAt: "2026-07-13T00:00:00.000Z"
  }
};

test("builds an identity-scoped update that preserves updatedAt byte for byte", () => {
  const update = buildBlingProductStatusConditionalUpdate({
    productId: "product-123",
    organizationId: "organization-123",
    connectionId: "connection-123",
    externalProductId: "12345",
    attributes: existingAttributes,
    updatedAt: originalUpdatedAt,
    status: "ACTIVE",
    externalStatus: "A",
    statusCheckedAt
  });

  assert.equal(update.where.id, "product-123");
  assert.equal(update.where.organizationId, "organization-123");
  assert.strictEqual(update.where.updatedAt, originalUpdatedAt);
  assert.deepEqual(update.where.mappings, {
    some: {
      organizationId: "organization-123",
      connectionId: "connection-123",
      externalProductId: "12345"
    }
  });
  assert.strictEqual(update.data.updatedAt, originalUpdatedAt);
});

for (const scenario of [
  { status: "ACTIVE", externalStatus: "A" },
  { status: "INACTIVE", externalStatus: "I" },
  { status: "DELETED", externalStatus: "E" }
] as const) {
  test(`preserves unrelated attributes while applying ${scenario.status}`, () => {
    const merged = mergeBlingProductStatusAttributes(
      existingAttributes,
      scenario.status,
      scenario.externalStatus,
      statusCheckedAt
    ) as typeof existingAttributes;

    assert.equal(merged.color, "blue");
    assert.deepEqual(merged.nested, { preserved: true });
    assert.equal(merged.bling.externalProductId, "12345");
    assert.equal(merged.bling.connectionId, "connection-123");
    assert.equal(merged.bling.source, "CATALOG_READ");
    assert.equal(merged.bling.customMetadata, "keep");
    assert.equal(merged.bling.status, scenario.status);
    assert.equal(merged.bling.externalStatus, scenario.externalStatus);
    assert.equal(merged.bling.statusCheckedAt, statusCheckedAt);
  });
}

test("classifies a lost optimistic update without forcing a write", () => {
  const concurrentUpdatedAt = new Date(originalUpdatedAt.getTime() + 1_000);
  assert.equal(
    classifyBlingProductStatusConditionalUpdate({
      count: 0,
      originalUpdatedAt,
      currentUpdatedAt: concurrentUpdatedAt,
      identityMatches: true
    }),
    "CONCURRENT_UPDATE"
  );
  assert.equal(
    classifyBlingProductStatusConditionalUpdate({
      count: 1,
      originalUpdatedAt,
      currentUpdatedAt: null,
      identityMatches: true
    }),
    "UPDATED"
  );
});

test("blocks an organization, connection or external ID identity mismatch", () => {
  assert.equal(
    classifyBlingProductStatusConditionalUpdate({
      count: 0,
      originalUpdatedAt,
      currentUpdatedAt: null,
      identityMatches: false
    }),
    "IDENTITY_MISMATCH"
  );
  assert.throws(() =>
    classifyBlingProductStatusConditionalUpdate({
      count: 2,
      originalUpdatedAt,
      currentUpdatedAt: originalUpdatedAt,
      identityMatches: true
    })
  );
});

test("does not turn an unknown external status into ACTIVE", () => {
  assert.deepEqual(normalizeBlingProductStatus("unexpected"), {
    status: "UNKNOWN",
    externalStatus: null
  });
});

test("recognizes an already correct status as canonical and idempotent", () => {
  const attributes = mergeBlingProductStatusAttributes(
    existingAttributes,
    "ACTIVE",
    "A",
    statusCheckedAt
  );
  assert.equal(readCanonicalBlingStatusFromAttributes(attributes), "ACTIVE");
});
