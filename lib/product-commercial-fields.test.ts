import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isValidDateOnly,
  isValidPackagingGtin,
  PRODUCT_COMMERCIAL_STATUS_VALUES,
  PRODUCT_FORMAT_VALUES,
  PRODUCT_PRODUCTION_TYPE_VALUES,
  PRODUCT_TYPE_VALUES
} from "./product-commercial-fields";

test("uses neutral closed enums for the four local commercial fields", () => {
  assert.deepEqual(PRODUCT_FORMAT_VALUES, ["SIMPLE", "VARIATION", "COMPOSITION"]);
  assert.deepEqual(PRODUCT_TYPE_VALUES, ["PRODUCT", "SERVICE", "SERVICE_06_21_22"]);
  assert.deepEqual(PRODUCT_COMMERCIAL_STATUS_VALUES, ["ACTIVE", "INACTIVE"]);
  assert.deepEqual(PRODUCT_PRODUCTION_TYPE_VALUES, ["OWN", "THIRD_PARTY"]);
});

test("accepts real date-only values and rejects invalid calendar dates", () => {
  assert.equal(isValidDateOnly("2028-02-29"), true);
  for (const value of ["2027-02-29", "2027-13-01", "31/12/2027", "2027-1-1", ""]) {
    assert.equal(isValidDateOnly(value), false);
  }
});

test("tax packaging GTIN accepts only checksummed GTIN-8, GTIN-12 or GTIN-13", () => {
  for (const value of ["78912342", "036000291452", "7908073723457"]) {
    assert.equal(isValidPackagingGtin(value), true, value);
  }
  for (const value of ["12345678", "790807372345X", "17891234567892", ""]) {
    assert.equal(isValidPackagingGtin(value), false, value);
  }
});

test("the reviewable migration is additive, nullable and contains no data rewrite", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "prisma/migrations/20260727000100_add_product_full_sync_fields/migration.sql"
    ),
    "utf8"
  );
  for (const column of [
    "format",
    "productType",
    "commercialStatus",
    "productionType",
    "expirationDate",
    "freeShipping",
    "volumes",
    "itemsPerBox",
    "packagingGtin"
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN "${column}"`));
  }
  assert.doesNotMatch(sql, /NOT NULL|DEFAULT|UPDATE|DELETE|DROP COLUMN|RENAME/i);
  assert.doesNotMatch(sql, /20260708000100_reconcile_schema_history/);
});

test("the product API reads and writes every field without accepting organization scope from the body", () => {
  const route = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/route.ts"),
    "utf8"
  );
  const fields = [
    "format",
    "productType",
    "commercialStatus",
    "productionType",
    "expirationDate",
    "freeShipping",
    "volumes",
    "itemsPerBox",
    "packagingGtin"
  ];
  for (const field of fields) {
    assert.match(route, new RegExp(`${field}: product\\.${field}`));
  }
  for (const field of fields.filter((field) => field !== "expirationDate")) {
    assert.match(route, new RegExp(`productData\\.${field} = parsed\\.data\\.${field}`));
  }
  assert.match(route, /productData\.expirationDate = parsed\.data\.expirationDate/);
  assert.match(route, /organizationId: auth\.context\.organizationId/);
  assert.doesNotMatch(route, /parsed\.data\.organizationId|body\.organizationId/);
});
