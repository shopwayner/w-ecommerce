import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import {
  INVENTORY_LIST_DEFAULT_LIMIT,
  buildCriticalInventoryIdsQuery,
  buildInventoryListCountQuery,
  buildInventoryListPageIdsQuery,
  buildInventorySummaryQuery,
  countInventoryList,
  findInventoryListPageIds,
  parseInventoryListRequest,
  type InventoryListQueryInput
} from "./inventory-list-query";

function input(overrides: Partial<InventoryListQueryInput> = {}): InventoryListQueryInput {
  return {
    organizationId: "org-current",
    selectedBlingConnectionId: null,
    query: "",
    ...overrides
  };
}

function compactSql(query: Prisma.Sql) {
  return query.sql.replace(/\s+/g, " ").trim();
}

test("accepts only bounded inventory page sizes", () => {
  assert.deepEqual(parseInventoryListRequest(new URLSearchParams()), {
    page: 1,
    limit: INVENTORY_LIST_DEFAULT_LIMIT,
    query: ""
  });
  assert.deepEqual(parseInventoryListRequest(new URLSearchParams("page=2&limit=100&q= Capacete  60 ")), {
    page: 2,
    limit: 100,
    query: "Capacete 60"
  });
  assert.equal(parseInventoryListRequest(new URLSearchParams("limit=200")).limit, 200);
  assert.equal(parseInventoryListRequest(new URLSearchParams("limit=6111")).limit, 50);
  assert.equal(parseInventoryListRequest(new URLSearchParams("page=-1&limit=all")).page, 1);
});

test("count and page queries share tenant and account predicates before pagination", () => {
  const queryInput = input({
    selectedBlingConnectionId: "bling-current",
    query: "Capacete 60"
  });
  const countQuery = buildInventoryListCountQuery(queryInput);
  const pageQuery = buildInventoryListPageIdsQuery(queryInput, { page: 3, limit: 50 });
  const countSql = compactSql(countQuery);
  const pageSql = compactSql(pageQuery);

  for (const sql of [countSql, pageSql]) {
    assert.match(sql, /inventory\."organizationId" = \?/);
    assert.match(sql, /product\."organizationId" = \?/);
    assert.match(sql, /connection\."organizationId" = \?/);
    assert.match(sql, /inventory\."connectionId" = \?/);
    assert.match(sql, /ProductExternalMapping/);
    assert.match(sql, /mapping\."connectionId" = inventory\."connectionId"/);
    assert.match(sql, /strpos\(lower\(product\.name\)/);
    assert.match(sql, /strpos\(lower\(COALESCE\(inventory\.warehouse/);
  }
  assert.match(pageSql, /ORDER BY inventory\."updatedAt" DESC, inventory\.id DESC/);
  assert.match(pageSql, /LIMIT \? OFFSET \?/);
  assert.equal(pageQuery.values.at(-2), 50);
  assert.equal(pageQuery.values.at(-1), 100);
  assert.equal(pageQuery.values.includes("org-current"), true);
  assert.equal(pageQuery.values.includes("bling-current"), true);
});

test("summary and critical sidebar are aggregated in PostgreSQL", () => {
  const summarySql = compactSql(buildInventorySummaryQuery(input()));
  const criticalSql = compactSql(buildCriticalInventoryIdsQuery(input()));

  assert.match(summarySql, /SUM\(inventory\."physicalQuantity"\)/);
  assert.match(summarySql, /SUM\(inventory\."reservedQuantity"\)/);
  assert.match(summarySql, /COUNT\(\*\) FILTER/);
  assert.match(summarySql, /inventory\."safetyQuantity"/);
  assert.match(criticalSql, /ORDER BY inventory\."physicalQuantity" - inventory\."reservedQuantity"/);
  assert.match(criticalSql, /LIMIT 8/);
  assert.doesNotMatch(summarySql, /SELECT inventory\.\*/);
  assert.doesNotMatch(criticalSql, /SELECT inventory\.\*/);
});

test("query runners return numeric totals and only the requested page IDs", async () => {
  const queries: Prisma.Sql[] = [];
  const client = {
    async $queryRaw<T>(query: Prisma.Sql) {
      queries.push(query);
      if (compactSql(query).startsWith("SELECT COUNT")) {
        return [{ total: 6111 }] as T;
      }
      return [{ id: "balance-51" }, { id: "balance-52" }] as T;
    }
  };

  assert.equal(await countInventoryList(client, input()), 6111);
  assert.deepEqual(
    await findInventoryListPageIds(client, input(), { page: 2, limit: 50 }),
    ["balance-51", "balance-52"]
  );
  assert.equal(queries.length, 2);
});

test("inventory route delegates to the paginated service without loading all balances", async () => {
  const routeSource = await readFile(
    path.join(process.cwd(), "app/api/inventory/route.ts"),
    "utf8"
  );
  const serviceSource = await readFile(
    path.join(process.cwd(), "lib/services/inventory-list-service.ts"),
    "utf8"
  );

  assert.match(routeSource, /requireApiAuth\("inventory:read"\)/);
  assert.match(routeSource, /loadInventoryListPage\(/);
  assert.match(routeSource, /new URL\(request\.url\)\.searchParams/);
  assert.match(serviceSource, /countInventoryList/);
  assert.match(serviceSource, /findInventoryListPageIds/);
  assert.match(serviceSource, /id: \{ in: requestedIds \}/);
  assert.match(serviceSource, /take: requestedIds\.length/);
  assert.match(serviceSource, /organizationId: authContext\.organizationId/);
  assert.doesNotMatch(serviceSource, /connection: true/);
  assert.doesNotMatch(serviceSource, /include:/);
  assert.doesNotMatch(serviceSource, /description: true/);
  assert.doesNotMatch(serviceSource, /prices:/);
  assert.doesNotMatch(serviceSource, /\.(?:create|update|upsert|delete|deleteMany|updateMany)\(/);
  assert.doesNotMatch(serviceSource, /BlingApiClient|fetch\(/);
  assert.doesNotMatch(routeSource, /export async function (?:POST|PUT|PATCH|DELETE)/);
});

test("inventory frontend requests remote pages and no longer paginates in memory", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components/pages/inventory-page.tsx"),
    "utf8"
  );

  assert.match(source, /new URLSearchParams\(\{[\s\S]*page: String\(currentPage\)[\s\S]*limit: String\(pageSize\)/);
  assert.match(source, /params\.set\("q", debouncedSearchQuery\)/);
  assert.match(source, /setTotalResults\(payload\.pagination\?\.total/);
  assert.match(source, /rows=\{items\.map/);
  assert.doesNotMatch(source, /filteredItems/);
  assert.doesNotMatch(source, /paginatedItems/);
  assert.doesNotMatch(source, /\.slice\(startIndex/);
  assert.doesNotMatch(source, /items\.filter/);
  assert.doesNotMatch(source, /items\s*\.sort/);
});
