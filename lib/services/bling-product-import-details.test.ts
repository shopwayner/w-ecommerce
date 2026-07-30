import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  hydrateNewBlingProductFromDetail,
  normalizeBlingCatalogPage,
  processBlingImportItemsIndependently,
  resolveImportedGtin
} from "./bling-product-import-service";

function summaryProduct() {
  const page = normalizeBlingCatalogPage({
    data: [{
      id: "external-product-1",
      codigo: "10321",
      nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
      unidade: "UN",
      formato: "S",
      situacao: "A"
    }],
    total: 1
  });
  assert.equal(page.products.length, 1);
  return page.products[0];
}

test("list without GTIN plus detail with GTIN supplies Product.ean", async () => {
  const product = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => ({
      data: {
        id: "external-product-1",
        codigo: "10321",
        nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
        gtin: "7908073723457",
        unidade: "UN",
        formato: "S",
        situacao: "A"
      }
    })
  );

  assert.equal(product.gtin, "7908073723457");
  assert.equal(resolveImportedGtin(product.gtin), "7908073723457");
});

test("detail keeps gtinEmbalagem separate from the primary GTIN", async () => {
  const product = await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-a",
      connectionId: "connection-a",
      product: summaryProduct()
    },
    async () => ({
      data: {
        id: "external-product-1",
        codigo: "10321",
        nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
        gtin: "7908073723457",
        gtinEmbalagem: "7891234567895"
      }
    })
  );

  assert.equal(resolveImportedGtin(product.gtin), "7908073723457");
  assert.equal(resolveImportedGtin(product.packagingGtin), "7891234567895");
});

test("summary without GTIN preserves an existing local EAN", () => {
  assert.equal(resolveImportedGtin(null, "7908073723457"), "7908073723457");
  assert.equal(resolveImportedGtin("", "7908073723457"), "7908073723457");
});

test("new product detail uses the organization and second connection provided", async () => {
  const requests: unknown[] = [];
  await hydrateNewBlingProductFromDetail(
    {
      organizationId: "organization-b",
      connectionId: "connection-b",
      product: summaryProduct()
    },
    async (request) => {
      requests.push(request);
      return {
        data: {
          id: "external-product-1",
          codigo: "10321",
          nome: "CAPACETE PLAY FUZZY BLK/RED 60/L RACE TECH",
          gtin: "7908073723457"
        }
      };
    }
  );

  assert.deepEqual(requests, [{
    organizationId: "organization-b",
    connectionId: "connection-b",
    externalProductId: "external-product-1"
  }]);
});

test("invalid remote GTIN is not persisted", () => {
  assert.equal(resolveImportedGtin("7891234567890"), null);
  assert.equal(
    resolveImportedGtin("7891234567890", "7908073723457"),
    "7908073723457"
  );
});

test("detail failure marks only that item and processing continues", async () => {
  const processed: string[] = [];
  const failed: string[] = [];
  const state = await processBlingImportItemsIndependently({
    items: ["bad-detail", "next-product"],
    initialState: 0,
    processItem: async (item, current) => {
      if (item === "bad-detail") throw new Error("DETAIL_FAILED");
      processed.push(item);
      return current + 1;
    },
    recordFailure: async (item, current) => {
      failed.push(item);
      return current + 1;
    }
  });

  assert.equal(state, 2);
  assert.deepEqual(failed, ["bad-detail"]);
  assert.deepEqual(processed, ["next-product"]);
});

test("runtime fetches detail only for CREATE and persists both GTIN fields", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/services/bling-product-import-service.ts"),
    "utf8"
  );

  assert.match(
    source,
    /preliminaryMatch\.kind === "CREATE"[\s\S]+hydrateNewBlingProductFromDetail/
  );
  assert.match(source, /classifyBlingProductsForConnection\(\{[\s\S]+matches: matching\.matches/);
  assert.match(source, /path: `\/produtos\/\$\{encodeURIComponent\(request\.externalProductId\)\}`/);
  assert.match(source, /ean,\s+packagingGtin,/);
  assert.match(source, /rawData: \{[\s\S]+packagingGtin: product\.packagingGtin/);
});
