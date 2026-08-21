import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { EMPTY_PRODUCT_LIST_FILTERS } from "./product-list-filters";
import {
  PRODUCT_LIST_DEFAULT_LIMIT,
  PRODUCT_LIST_MAX_LIMIT,
  buildProductListCountQuery,
  buildProductListMetadataQuery,
  buildProductListPageIdsQuery,
  countProductList,
  findProductListPageIds,
  loadProductListCatalogMetadata,
  parseProductListPagination,
  type ProductListQueryInput
} from "./product-list-query";

function input(overrides: Partial<ProductListQueryInput> = {}): ProductListQueryInput {
  return {
    organizationId: "org-current",
    selectedBlingConnectionId: null,
    filters: { ...EMPTY_PRODUCT_LIST_FILTERS },
    query: "",
    status: null,
    skuStatus: null,
    stockStatus: null,
    imageStatus: null,
    descriptionStatus: null,
    categoryStatus: null,
    gtinStatus: null,
    costStatus: null,
    qualityBand: null,
    mercadoLivreCategoryStatus: null,
    source: null,
    sort: null,
    ...overrides
  };
}

function compactSql(query: Prisma.Sql) {
  return query.sql.replace(/\s+/g, " ").trim();
}

test("validates page and limit without supporting an unbounded list", () => {
  assert.deepEqual(parseProductListPagination(new URLSearchParams()), {
    page: 1,
    limit: PRODUCT_LIST_DEFAULT_LIMIT
  });
  assert.deepEqual(parseProductListPagination(new URLSearchParams("page=2&limit=50")), {
    page: 2,
    limit: 50
  });
  assert.deepEqual(parseProductListPagination(new URLSearchParams("page=-2&limit=all")), {
    page: 1,
    limit: PRODUCT_LIST_DEFAULT_LIMIT
  });
  assert.equal(
    parseProductListPagination(new URLSearchParams("limit=999999")).limit,
    PRODUCT_LIST_MAX_LIMIT
  );
});

test("count and page queries share tenant-scoped filters before LIMIT and OFFSET", () => {
  const queryInput = input({
    selectedBlingConnectionId: "bling-current",
    query: " Capacete  60 ",
    filters: {
      ...EMPTY_PRODUCT_LIST_FILTERS,
      images: "with",
      stock: "with",
      brand: "ASX"
    }
  });
  const countQuery = buildProductListCountQuery(queryInput);
  const pageQuery = buildProductListPageIdsQuery(queryInput, { page: 3, limit: 20 });
  const countSql = compactSql(countQuery);
  const pageSql = compactSql(pageQuery);

  assert.match(countSql, /product\."organizationId" = \?/);
  assert.match(countSql, /mapping_source\."connectionId" = \?/);
  assert.match(countSql, /mapping\.id IS NOT NULL/);
  assert.match(countSql, /strpos\(/);
  assert.match(countSql, /scored\.stock > 0/);
  assert.match(countSql, /scored\.image_url/);
  assert.match(countSql, /scored\.normalized_brand/);
  assert.match(pageSql, /ORDER BY/);
  assert.match(pageSql, /LIMIT \? OFFSET \?/);
  assert.equal(pageQuery.values.at(-2), 20);
  assert.equal(pageQuery.values.at(-1), 40);
  assert.equal(pageQuery.values.includes("org-current"), true);
  assert.equal(pageQuery.values.includes("bling-current"), true);
});

test("all supported legacy filters remain part of the database predicate", () => {
  const query = buildProductListCountQuery(input({
    skuStatus: "without",
    stockStatus: "with",
    imageStatus: "without",
    descriptionStatus: "with",
    categoryStatus: "with",
    gtinStatus: "with",
    costStatus: "with",
    qualityBand: "ready",
    mercadoLivreCategoryStatus: "attributesPending",
    status: "IMPORTED",
    source: "BLING"
  }));
  const sql = compactSql(query);

  assert.match(sql, /BLING-%/);
  assert.match(sql, /scored\.stock > 0/);
  assert.match(sql, /scored\.description/);
  assert.match(sql, /scored\.category/);
  assert.match(sql, /scored\.ean/);
  assert.match(sql, /scored\.cost_price/);
  assert.match(sql, /scored\.quality_score/);
  assert.match(sql, /has_attributes_synced/);
  assert.match(sql, /scored\."enrichmentStatus"/);
  assert.match(sql, /scored\.source/);
});

test("database ordering is deterministic for every supported sort", () => {
  for (const sort of [
    null,
    "quality_asc",
    "stock_desc",
    "without_sku",
    "recent",
    "name_asc",
    "stock_value_desc",
    "price_desc",
    "price_asc"
  ]) {
    const sql = compactSql(buildProductListPageIdsQuery(input({ sort }), { page: 1, limit: 20 }));
    assert.match(sql, /ORDER BY/);
    assert.match(sql, /scored\.id/);
  }
});

test("metadata is aggregated in PostgreSQL instead of materializing all products", () => {
  const sql = compactSql(buildProductListMetadataQuery({
    organizationId: "org-current",
    selectedBlingConnectionId: null
  }));
  assert.match(sql, /COUNT\(\*\).*totalProducts/);
  assert.match(sql, /GROUP BY 1/);
  assert.match(sql, /jsonb_agg/);
  assert.doesNotMatch(sql, /SELECT scored\.\*/);
});

test("query runners return only page IDs and numeric totals", async () => {
  const queries: Prisma.Sql[] = [];
  const client = {
    async $queryRaw<T>(query: Prisma.Sql) {
      queries.push(query);
      if (compactSql(query).includes("COUNT(*)::integer AS total")) {
        return [{ total: 6112 }] as T;
      }
      return [{ id: "p-21" }, { id: "p-22" }] as T;
    }
  };

  assert.equal(await countProductList(client, input()), 6112);
  assert.deepEqual(
    await findProductListPageIds(client, input(), { page: 2, limit: 20 }),
    ["p-21", "p-22"]
  );
  assert.equal(queries.length, 2);
});

test("metadata runner preserves grouped labels, counts and truncation", async () => {
  const categories = Array.from({ length: 501 }, (_, index) => ({
    value: `category-${index}`,
    label: `Categoria ${index}`,
    count: 1
  }));
  const client = {
    async $queryRaw<T>() {
      return [{
        totalProducts: 6112,
        importedFromBlingCount: 6078,
        readyForTestCount: 12,
        unknownBlingStatusCount: 3,
        marketplaceCount: 6078,
        localCount: 34,
        categories,
        brands: [{ value: "asx", label: "ASX", count: 20 }]
      }] as T;
    }
  };

  const metadata = await loadProductListCatalogMetadata(client, {
    organizationId: "org-current",
    selectedBlingConnectionId: null
  });
  assert.equal(metadata.summary.totalProducts, 6112);
  assert.deepEqual(metadata.filterOptions.origins.map((option) => option.count), [6078, 34]);
  assert.equal(metadata.filterOptions.categories.length, 500);
  assert.equal(metadata.filterOptions.categoriesTruncated, true);
  assert.deepEqual(metadata.filterOptions.brands, [{ value: "asx", label: "ASX", count: 20 }]);
});

test("products route loads only page IDs with take and no in-memory slice", async () => {
  const source = await readFile(path.join(process.cwd(), "app/api/products/route.ts"), "utf8");
  assert.match(source, /id: \{ in: productIds \}/);
  assert.match(source, /take: requestedPagination\.limit/);
  assert.match(source, /findProductListPageIds/);
  assert.match(source, /countProductList/);
  assert.doesNotMatch(source, /sorted\.slice|pageProducts|loadAll/);
  assert.doesNotMatch(source, /description: true/);
  assert.doesNotMatch(source, /enrichmentDrafts:/);
  assert.doesNotMatch(source, /marketplaceCategoryMappings:/);
});

test("AI product selector no longer depends on an unbounded products response", async () => {
  const source = await readFile(path.join(process.cwd(), "components/pages/ia-page.tsx"), "utf8");
  assert.match(source, /new URLSearchParams\(\{ page: "1", limit: "100" \}\)/);
  assert.match(source, /params\.set\("q", query\.trim\(\)\)/);
  assert.match(source, /onProductSearch\(query, selectedProductIdRef\.current\)/);
  assert.match(source, /fetch\(`\/api\/products\/\$\{encodeURIComponent\(productId\)\}`\)/);
  assert.doesNotMatch(source, /fetch\("\/api\/products"\)/);
});
