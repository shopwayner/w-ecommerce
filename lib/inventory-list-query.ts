import { Prisma } from "@prisma/client";

export const INVENTORY_LIST_DEFAULT_LIMIT = 50;
export const INVENTORY_LIST_ALLOWED_LIMITS = [50, 100, 200] as const;

export type InventoryListScope = {
  organizationId: string;
  selectedBlingConnectionId: string | null;
};

export type InventoryListQueryInput = InventoryListScope & {
  query: string;
};

export type InventoryListPagination = {
  page: number;
  limit: number;
};

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseInventoryListRequest(searchParams: URLSearchParams) {
  const requestedLimit = positiveInteger(
    searchParams.get("limit"),
    INVENTORY_LIST_DEFAULT_LIMIT
  );
  const limit = INVENTORY_LIST_ALLOWED_LIMITS.includes(
    requestedLimit as (typeof INVENTORY_LIST_ALLOWED_LIMITS)[number]
  )
    ? requestedLimit
    : INVENTORY_LIST_DEFAULT_LIMIT;

  return {
    page: positiveInteger(searchParams.get("page"), 1),
    limit,
    query: searchParams.get("q")?.trim().replace(/\s+/g, " ").slice(0, 160) ?? ""
  };
}

function inventoryScopePredicate(scope: InventoryListScope) {
  const connectionPredicate = scope.selectedBlingConnectionId
    ? Prisma.sql`AND inventory."connectionId" = ${scope.selectedBlingConnectionId}`
    : Prisma.empty;

  return Prisma.sql`
    inventory."organizationId" = ${scope.organizationId}
    AND product."organizationId" = ${scope.organizationId}
    AND connection."organizationId" = ${scope.organizationId}
    ${connectionPredicate}
  `;
}

function inventorySearchPredicate(input: InventoryListQueryInput) {
  if (!input.query) return Prisma.empty;

  return Prisma.sql`
    AND (
      strpos(lower(product.name), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(product.sku, '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(product.ean, '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(inventory.warehouse, '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(connection.name, '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(connection."externalCompanyName", '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(connection."externalCompanyDocument", '')), lower(${input.query})) > 0
      OR strpos(lower(COALESCE(connection."externalAccountId", '')), lower(${input.query})) > 0
      OR EXISTS (
        SELECT 1
        FROM "ProductExternalMapping" mapping
        WHERE mapping."organizationId" = ${input.organizationId}
          AND mapping."productId" = inventory."productId"
          AND mapping."connectionId" = inventory."connectionId"
          AND strpos(lower(mapping."externalProductId"), lower(${input.query})) > 0
      )
    )
  `;
}

function inventoryFromAndWhere(input: InventoryListQueryInput) {
  return Prisma.sql`
    FROM "InventoryBalance" inventory
    INNER JOIN "Product" product ON product.id = inventory."productId"
    INNER JOIN "BlingConnection" connection ON connection.id = inventory."connectionId"
    WHERE ${inventoryScopePredicate(input)}
    ${inventorySearchPredicate(input)}
  `;
}

export function buildInventoryListCountQuery(input: InventoryListQueryInput) {
  return Prisma.sql`
    SELECT COUNT(*)::integer AS total
    ${inventoryFromAndWhere(input)}
  `;
}

export function buildInventoryListPageIdsQuery(
  input: InventoryListQueryInput,
  pagination: InventoryListPagination
) {
  const offset = (pagination.page - 1) * pagination.limit;
  return Prisma.sql`
    SELECT inventory.id
    ${inventoryFromAndWhere(input)}
    ORDER BY inventory."updatedAt" DESC, inventory.id DESC
    LIMIT ${pagination.limit}
    OFFSET ${offset}
  `;
}

export function buildInventorySummaryQuery(scope: InventoryListScope) {
  return Prisma.sql`
    SELECT
      COUNT(*)::integer AS "totalItems",
      COALESCE(SUM(inventory."physicalQuantity"), 0)::double precision AS "totalPhysical",
      COALESCE(SUM(inventory."reservedQuantity"), 0)::double precision AS "totalReserved",
      COUNT(*) FILTER (
        WHERE inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" <= 0
      )::integer AS "ruptureCount",
      COUNT(*) FILTER (
        WHERE inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" > 0
          AND inventory."minQuantity" IS NOT NULL
          AND inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" <= inventory."minQuantity"
      )::integer AS "lowStockCount"
    FROM "InventoryBalance" inventory
    INNER JOIN "Product" product ON product.id = inventory."productId"
    INNER JOIN "BlingConnection" connection ON connection.id = inventory."connectionId"
    WHERE ${inventoryScopePredicate(scope)}
  `;
}

export function buildCriticalInventoryIdsQuery(scope: InventoryListScope) {
  return Prisma.sql`
    SELECT inventory.id
    FROM "InventoryBalance" inventory
    INNER JOIN "Product" product ON product.id = inventory."productId"
    INNER JOIN "BlingConnection" connection ON connection.id = inventory."connectionId"
    WHERE ${inventoryScopePredicate(scope)}
      AND (
        inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" <= 0
        OR (
          inventory."minQuantity" IS NOT NULL
          AND inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" <= inventory."minQuantity"
        )
      )
    ORDER BY
      inventory."physicalQuantity" - inventory."reservedQuantity" - inventory."safetyQuantity" ASC,
      lower(product.name) ASC,
      inventory.id ASC
    LIMIT 8
  `;
}

type CountClient = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
};

export async function countInventoryList(
  client: CountClient,
  input: InventoryListQueryInput
) {
  const rows = await client.$queryRaw<Array<{ total: number }>>(
    buildInventoryListCountQuery(input)
  );
  return Number(rows[0]?.total ?? 0);
}

export async function findInventoryListPageIds(
  client: CountClient,
  input: InventoryListQueryInput,
  pagination: InventoryListPagination
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(
    buildInventoryListPageIdsQuery(input, pagination)
  );
  return rows.map((row) => row.id);
}
