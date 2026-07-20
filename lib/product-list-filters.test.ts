import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductListFilterOptions,
  getProductPaginationItems,
  getProductOrigin,
  matchesProductListFilters,
  parseProductListFilters,
  type ProductListFilterable
} from "./product-list-filters";

function product(overrides: Partial<ProductListFilterable> = {}): ProductListFilterable {
  return {
    name: "Sensor PCX",
    sku: "6592",
    ean: "7908253862527",
    imageUrl: "https://example.com/image.jpg",
    stock: 2,
    source: "BLING",
    category: "Sensores",
    brand: "T-Mac",
    blingStatus: "ACTIVE",
    blingAccount: { id: "mapping" },
    ...overrides
  };
}

test("parses only supported filter values", () => {
  const filters = parseProductListFilters(new URLSearchParams(
    "origin=marketplace&gtin=with&images=without&stock=negative&blingStatus=inactive&blingLink=with&category=Sensores&brand=T-Mac"
  ));
  assert.deepEqual(filters, {
    origin: "marketplace",
    gtin: "with",
    images: "without",
    stock: "negative",
    blingStatus: "inactive",
    blingLink: "with",
    category: "Sensores",
    brand: "T-Mac"
  });
  assert.equal(parseProductListFilters(new URLSearchParams("stock=invalid")).stock, "all");
});

test("classifies only proven external sources or links as marketplace", () => {
  assert.equal(getProductOrigin(product()), "marketplace");
  assert.equal(getProductOrigin(product({ source: "Cadastro manual", blingAccount: null })), "local");
  assert.equal(getProductOrigin(product({ source: null, blingAccount: { id: "mapping" } })), "marketplace");
});

test("combines search, presence, stock, status, link, category and brand filters", () => {
  const filters = parseProductListFilters(new URLSearchParams(
    "origin=marketplace&gtin=with&images=with&stock=with&blingStatus=active&blingLink=with&category=sensores&brand=t-mac"
  ));
  assert.equal(matchesProductListFilters(product(), filters, "sensor"), true);
  assert.equal(matchesProductListFilters(product({ ean: "   " }), filters, "sensor"), false);
  assert.equal(matchesProductListFilters(product({ stock: 0 }), filters, "sensor"), false);
  assert.equal(matchesProductListFilters(product({ blingStatus: "INACTIVE" }), filters, "sensor"), false);
});

test("treats blank GTIN and non-positive stock as absent", () => {
  const filters = parseProductListFilters(new URLSearchParams("gtin=without&stock=without"));
  assert.equal(matchesProductListFilters(product({ ean: " ", stock: 0 }), filters), true);
  assert.equal(matchesProductListFilters(product({ ean: null, stock: -2 }), filters), true);
  assert.equal(matchesProductListFilters(product({ ean: "123", stock: 1 }), filters), false);
});

test("filters images, Bling links and canonical statuses independently", () => {
  const candidate = product({ imageUrl: null, blingAccount: null, blingStatus: "DELETED" });
  assert.equal(
    matchesProductListFilters(candidate, parseProductListFilters(new URLSearchParams("images=without"))),
    true
  );
  assert.equal(
    matchesProductListFilters(candidate, parseProductListFilters(new URLSearchParams("blingLink=without"))),
    true
  );
  assert.equal(
    matchesProductListFilters(candidate, parseProductListFilters(new URLSearchParams("blingStatus=deleted"))),
    true
  );
  assert.equal(
    matchesProductListFilters(candidate, parseProductListFilters(new URLSearchParams("blingStatus=active"))),
    false
  );
});

test("matches normalized text search across title, SKU and GTIN", () => {
  const all = parseProductListFilters(new URLSearchParams());
  assert.equal(matchesProductListFilters(product(), all, "  SENSOR   pcx "), true);
  assert.equal(matchesProductListFilters(product(), all, "6592"), true);
  assert.equal(matchesProductListFilters(product(), all, "7908253862527"), true);
  assert.equal(matchesProductListFilters(product(), all, "produto diferente"), false);
});

test("deduplicates category and brand options without changing stored labels", () => {
  const options = buildProductListFilterOptions([
    product(),
    product({ category: " sensores ", brand: "t-mac" }),
    product({ source: "Cadastro manual", blingAccount: null, category: null, brand: null })
  ]);
  assert.deepEqual(options.origins.map((option) => [option.value, option.count]), [["marketplace", 2], ["local", 1]]);
  assert.deepEqual(options.categories.map((option) => [option.label, option.count]), [["Sem categoria", 1], ["Sensores", 2]]);
  assert.deepEqual(options.brands.map((option) => [option.label, option.count]), [["Sem marca", 1], ["T-Mac", 2]]);
});

test("slides the three-page window while keeping the last page available", () => {
  const ellipsis = "ellipsis";

  assert.deepEqual(getProductPaginationItems(1, 136), [1, 2, 3, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(2, 136), [1, 2, 3, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(3, 136), [2, 3, 4, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(4, 136), [3, 4, 5, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(50, 136), [49, 50, 51, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(134, 136), [133, 134, 135, ellipsis, 136]);
  assert.deepEqual(getProductPaginationItems(135, 136), [134, 135, 136]);
  assert.deepEqual(getProductPaginationItems(136, 136), [134, 135, 136]);
});

test("does not repeat pages when the result has three pages or fewer", () => {
  assert.deepEqual(getProductPaginationItems(1, 1), [1]);
  assert.deepEqual(getProductPaginationItems(2, 2), [1, 2]);
  assert.deepEqual(getProductPaginationItems(3, 3), [1, 2, 3]);
});
