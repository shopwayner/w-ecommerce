import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPROVED_BASELINE_MANIFEST_HASH,
  canonicalManifest,
  canonicalizeCatalogRow,
  countManifestSections,
  diffManifests,
  hashManifest,
  manifestFromBaselineSql,
  normalizeDefault,
  normalizeType,
  serializeManifest,
} from "./prisma-schema-manifest";

const baselineSql = readFileSync(
  "prisma/migrations/20260823000000_baseline_production_schema/migration.sql",
  "utf8",
);
const catalogSql = readFileSync("scripts/prisma-schema-manifest.sql", "utf8");
const runbook = readFileSync("docs/codex/PRISMA_BASELINE_CUTOVER_RUNBOOK.md", "utf8");

test("canonical baseline manifest has the approved deterministic hash and counts", () => {
  const manifest = canonicalManifest(manifestFromBaselineSql(baselineSql));

  assert.equal(hashManifest(manifest), APPROVED_BASELINE_MANIFEST_HASH);
  assert.equal(manifest.length, 1030);
  assert.deepEqual(countManifestSections(manifest), {
    column: 623,
    enum: 27,
    foreignKey: 66,
    index: 226,
    primaryKey: 44,
    table: 44,
  });
  assert.ok(serializeManifest(manifest).endsWith("\n"));
  assert.ok(!serializeManifest(manifest).includes("\r"));
});

test("catalog canonicalization ignores physical ordinals, schemas, and index names", () => {
  const column = canonicalizeCatalogRow({
    section: "column",
    schema: "public",
    table: "Example",
    ordinal: 19,
    column: "value",
    type: "INTEGER",
    udtSchema: "pg_catalog",
    udt: "int4",
    nullable: false,
    default: "(0)::integer",
    identity: "",
    generated: "",
  });
  const index = canonicalizeCatalogRow({
    section: "index",
    schema: "public",
    table: "Example",
    indexName: "arbitrary_truncated_name",
    unique: true,
    nullsNotDistinct: false,
    method: "btree",
    keys: ["value ASC"],
    include: [],
    predicate: null,
  });

  assert.deepEqual(column, {
    section: "column",
    table: "Example",
    column: "value",
    type: "integer",
    nullable: false,
    default: "0",
    identity: "",
    generated: "",
  });
  assert.equal("ordinal" in column, false);
  assert.equal("schema" in column, false);
  assert.equal("indexName" in index, false);
});

test("equivalent types and default casts normalize to the same semantic values", () => {
  assert.equal(normalizeType("DECIMAL(10,2)"), "numeric(10,2)");
  assert.equal(normalizeType("TIMESTAMP(3)"), "timestamp(3) without time zone");
  assert.equal(normalizeDefault("'ACTIVE'::text"), "'ACTIVE'");
  assert.equal(normalizeDefault("(0)::integer"), "0");
  assert.equal(normalizeDefault("CURRENT_TIMESTAMP"), "CURRENT_TIMESTAMP");
});

test("a single OrderItem FK drift changes the hash and is identified object by object", () => {
  const baseline = canonicalManifest(manifestFromBaselineSql(baselineSql));
  const drifted = baseline
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (
        row.section === "foreignKey" &&
        row.table === "OrderItem" &&
        Array.isArray(row.columns) &&
        row.columns[0] === "productId"
      ) {
        row.onDelete = "SET NULL";
      }
      return JSON.stringify(row);
    })
    .sort();
  const diff = diffManifests(baseline, drifted);

  assert.notEqual(hashManifest(drifted), APPROVED_BASELINE_MANIFEST_HASH);
  assert.equal(diff.expectedOnly.length, 1);
  assert.equal(diff.actualOnly.length, 1);
  assert.match(diff.expectedOnly[0], /"onDelete":"RESTRICT"/);
  assert.match(diff.actualOnly[0], /"onDelete":"SET NULL"/);
});

test("catalog extraction remains read only and captures every required semantic property", () => {
  assert.doesNotMatch(catalogSql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
  assert.match(catalogSql, /NOT a\.attisdropped/);
  assert.match(catalogSql, /con\.contype IN \('p', 'u'\)/);
  assert.match(catalogSql, /con\.contype = 'f'/);
  assert.match(catalogSql, /confdeltype/);
  assert.match(catalogSql, /confupdtype/);
  assert.match(catalogSql, /indisunique/);
  assert.match(catalogSql, /indnullsnotdistinct/);
  assert.match(catalogSql, /indpred/);
  assert.match(catalogSql, /indnkeyatts/);
  assert.match(catalogSql, /'_prisma_migrations'/);
});

test("runbook uses the semantic gate and retains the old hash only as deprecated evidence", () => {
  assert.match(runbook, new RegExp(APPROVED_BASELINE_MANIFEST_HASH));
  assert.match(runbook, /Deprecated PostgreSQL dump fingerprint/);
  assert.match(runbook, /prohibited as a gate/);
  assert.doesNotMatch(runbook, /pg_dump --schema-only/);
  assert.match(runbook, /1,030 total/);
  assert.match(runbook, /empty object-by-object diff/);
});
