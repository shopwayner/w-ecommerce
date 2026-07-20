import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { BlingApiError } from "./bling-api-client";
import {
  runBlingProductBrandBackfill,
  type BlingProductBrandBackfillDependencies,
  type BlingProductBrandBackfillRow
} from "./bling-product-brand-backfill";

function row(overrides: Partial<BlingProductBrandBackfillRow> = {}): BlingProductBrandBackfillRow {
  return {
    mappingId: "mapping_1234567890",
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    externalProductId: "123456789",
    productId: "product_1234567890",
    productSku: "7680",
    productBrand: null,
    productUpdatedAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides
  };
}

function dependencies(
  rows: BlingProductBrandBackfillRow[],
  payload: unknown,
  overrides: Partial<BlingProductBrandBackfillDependencies> = {}
): BlingProductBrandBackfillDependencies {
  return {
    listLinkedProducts: async () => rows,
    fetchProductDetail: async () => payload,
    updateProductBrand: async () => "UPDATED",
    wait: async () => undefined,
    ...overrides
  };
}

test("dry-run reads data.marca and performs no update", async () => {
  let updates = 0;
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    inspectSkus: ["7680"],
    dependencies: dependencies([row()], { data: { marca: "T-Mac" } }, {
      updateProductBrand: async () => {
        updates += 1;
        return "UPDATED";
      }
    })
  });

  assert.equal(report.candidateProducts, 1);
  assert.equal(report.recordsWouldChange, 1);
  assert.equal(report.totalConsulted, 1);
  assert.equal(report.remoteRequests, 1);
  assert.equal(report.writesPerformed, 0);
  assert.equal(report.externalWritesPerformed, 0);
  assert.equal(report.samples[0]?.normalizedBrand, "T-Mac");
  assert.equal(updates, 0);
});

test("products with a valid local brand are excluded from remote consultation", async () => {
  let reads = 0;
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    dependencies: dependencies([row({ productSku: "6592", productBrand: "T-Mac" })], null, {
      fetchProductDetail: async () => {
        reads += 1;
        return null;
      }
    })
  });

  assert.equal(report.candidateProducts, 0);
  assert.equal(report.alreadyWithValidBrand, 1);
  assert.equal(report.recordsAlreadyCorrect, 1);
  assert.equal(report.totalConsulted, 0);
  assert.equal(reads, 0);
});

test("empty and generic remote brands are reported separately", async () => {
  const payloads = [{ data: { marca: "N/A" } }, { data: { marca: "  " } }];
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    dependencies: dependencies([
      row({ productSku: "1" }),
      row({ mappingId: "mapping_2", productId: "product_2", externalProductId: "2", productSku: "2" })
    ], null, {
      fetchProductDetail: async () => payloads.shift()
    })
  });

  assert.equal(report.genericBrandsDiscarded, 1);
  assert.equal(report.withoutRemoteBrand, 1);
  assert.equal(report.withoutValidBrandAfter, 2);
  assert.equal(report.recordsWouldChange, 0);
});

test("a rate limit response receives only one bounded retry", async () => {
  let reads = 0;
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    dependencies: dependencies([row()], null, {
      fetchProductDetail: async () => {
        reads += 1;
        if (reads === 1) throw new BlingApiError("rate", 429, "RATE_LIMITED", 1);
        return { data: { marca: "DANIDREA" } };
      }
    })
  });

  assert.equal(reads, 2);
  assert.equal(report.remoteRequests, 2);
  assert.equal(report.retries, 1);
  assert.equal(report.errors429, 0);
  assert.equal(report.recordsWouldChange, 1);
});

test("authentication failure stops before consulting the next product", async () => {
  let reads = 0;
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    dependencies: dependencies([
      row(),
      row({ mappingId: "mapping_2", productId: "product_2", externalProductId: "2", productSku: "2" })
    ], null, {
      fetchProductDetail: async () => {
        reads += 1;
        throw new BlingApiError("expired", 401, "TOKEN_EXPIRED");
      }
    })
  });

  assert.equal(reads, 1);
  assert.equal(report.totalConsulted, 1);
  assert.equal(report.errors401, 1);
  assert.equal(report.abortedByAuthentication, true);
});

test("not found products are counted without retry", async () => {
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: false,
    dependencies: dependencies([row()], null, {
      fetchProductDetail: async () => {
        throw new BlingApiError("missing", 404, "REQUEST_REJECTED");
      }
    })
  });

  assert.equal(report.remoteRequests, 1);
  assert.equal(report.notFound, 1);
  assert.equal(report.errors404, 1);
  assert.equal(report.retries, 0);
});

test("confirmed mode updates only the planned brand and preserves the product timestamp", async () => {
  const state = {
    brand: null as string | null,
    name: "Produto preservado",
    sku: "7680",
    price: 154.24,
    stock: 2,
    updatedAt: new Date("2026-07-20T12:00:00.000Z")
  };
  const before = structuredClone(state);
  const events: string[] = [];
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: true,
    onPlanReady: async (plan) => {
      events.push("PLAN_READY");
      assert.equal(state.brand, null);
      assert.deepEqual(plan, [{
        productId: "product_1234567890",
        sku: "7680",
        previousBrand: null,
        newBrand: "T-Mac"
      }]);
    },
    dependencies: dependencies([row()], { data: { marca: "T-Mac" } }, {
      updateProductBrand: async ({ brand }) => {
        events.push("UPDATE");
        state.brand = brand;
        return "UPDATED";
      }
    })
  });

  assert.equal(report.writesPerformed, 1);
  assert.equal(state.brand, "T-Mac");
  assert.deepEqual({ ...state, brand: before.brand }, before);
  assert.equal(report.productUpdatedAtPreserved, true);
  assert.deepEqual(events, ["PLAN_READY", "UPDATE"]);
});

test("confirmed mode performs no local write when authentication fails during planning", async () => {
  let updates = 0;
  let plans = 0;
  const report = await runBlingProductBrandBackfill({
    organizationId: "organization_1234567890",
    connectionId: "connection_1234567890",
    confirm: true,
    onPlanReady: async () => {
      plans += 1;
    },
    dependencies: dependencies([
      row(),
      row({ mappingId: "mapping_2", productId: "product_2", externalProductId: "2", productSku: "2" })
    ], null, {
      fetchProductDetail: async (currentRow) => {
        if (currentRow.productSku === "7680") return { data: { marca: "SCT" } };
        throw new BlingApiError("expired", 401, "TOKEN_EXPIRED");
      },
      updateProductBrand: async () => {
        updates += 1;
        return "UPDATED";
      }
    })
  });

  assert.equal(report.abortedByAuthentication, true);
  assert.equal(report.writesPerformed, 0);
  assert.equal(plans, 0);
  assert.equal(updates, 0);
});

test("service has no external write path and uses a timed read-only Bling client", () => {
  const source = readFileSync(new URL("./bling-product-brand-backfill.ts", import.meta.url), "utf8");
  assert.match(source, /blingApiClient\.requestReadOnly/);
  assert.match(source, /timeoutMs:\s*30_000/);
  assert.doesNotMatch(source, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("script defaults to dry-run and requires an explicit confirm argument", () => {
  const source = readFileSync(
    path.join(process.cwd(), "scripts/backfill-bling-product-brands.ts"),
    "utf8"
  );
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(source, /argumentsList\.includes\("--confirm"\)/);
  assert.match(source, /confirm:\s*options\.confirm/);
  assert.match(source, /BLING_PRODUCT_BRAND_PLAN_OUTPUT/);
  assert.match(source, /flag:\s*"wx"/);
  assert.match(source, /mode:\s*0o600/);
  assert.equal(packageJson.scripts["bling:backfill-product-brands"], "tsx scripts/backfill-bling-product-brands.ts");
});

test("product detail API returns brand and the modal renders the Brand card", () => {
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/products/[id]/route.ts"),
    "utf8"
  );
  const pageSource = readFileSync(
    path.join(process.cwd(), "components/pages/products-page.tsx"),
    "utf8"
  );
  assert.match(routeSource, /const brand = normalizeProductBrand\(product\.brand\)/);
  assert.match(routeSource, /\n\s+brand,/);
  assert.match(routeSource, /requireApiAuth\("products:read"\)/);
  assert.match(pageSource, /label:\s*"Marca"/);
  assert.match(pageSource, /value:\s*product\.brand\s*\?\?\s*"Sem marca"/);
});
