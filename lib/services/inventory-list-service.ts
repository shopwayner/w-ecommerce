import "server-only";

import type { Prisma } from "@prisma/client";
import type { TenantContext } from "@/lib/auth/server";
import {
  buildCriticalInventoryIdsQuery,
  buildInventorySummaryQuery,
  countInventoryList,
  findInventoryListPageIds,
  parseInventoryListRequest,
  type InventoryListScope
} from "@/lib/inventory-list-query";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";

const inventoryListSelect = {
  id: true,
  productId: true,
  connectionId: true,
  warehouse: true,
  physicalQuantity: true,
  reservedQuantity: true,
  safetyQuantity: true,
  minQuantity: true,
  maxQuantity: true,
  status: true,
  updatedAt: true,
  connection: {
    select: {
      name: true,
      externalCompanyName: true,
      externalCompanyDocument: true,
      externalAccountId: true,
      status: true
    }
  },
  product: {
    select: {
      name: true,
      sku: true,
      ean: true,
      images: {
        take: 1,
        orderBy: { position: "asc" },
        select: { url: true }
      },
      mappings: {
        orderBy: { updatedAt: "desc" },
        select: {
          connectionId: true,
          externalProductId: true
        }
      }
    }
  }
} satisfies Prisma.InventoryBalanceSelect;

type InventoryListRecord = Prisma.InventoryBalanceGetPayload<{
  select: typeof inventoryListSelect;
}>;

type InventorySummaryRow = {
  totalItems: number;
  totalPhysical: number;
  totalReserved: number;
  ruptureCount: number;
  lowStockCount: number;
};

function statusFromQuantities(availableQuantity: number, minQuantity: number | null) {
  if (availableQuantity <= 0) return "RUPTURE" as const;
  if (minQuantity !== null && availableQuantity <= minQuantity) return "LOW_STOCK" as const;
  return "OK" as const;
}

function serializeInventory(item: InventoryListRecord) {
  const mapping =
    item.product.mappings.find(
      (productMapping) => productMapping.connectionId === item.connectionId
    ) ?? null;
  const safetyStock = item.safetyQuantity;
  const availableQuantity =
    item.physicalQuantity - item.reservedQuantity - safetyStock;
  const status = statusFromQuantities(availableQuantity, item.minQuantity);
  const blingAccountName =
    item.connection.name ||
    item.connection.externalCompanyName ||
    item.connection.externalCompanyDocument ||
    item.connection.externalAccountId ||
    "Conta Bling";

  return {
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    sku: item.product.sku,
    ean: item.product.ean,
    imageUrl: item.product.images[0]?.url ?? null,
    bling: {
      connectionId: item.connectionId,
      name: blingAccountName,
      status: item.connection.status,
      externalProductId: mapping?.externalProductId ?? null
    },
    deposit: item.warehouse,
    physicalQuantity: item.physicalQuantity,
    reservedQuantity: item.reservedQuantity,
    safetyStock,
    availableQuantity,
    minQuantity: item.minQuantity,
    maxQuantity: item.maxQuantity,
    status,
    rawStatus: item.status,
    updatedAt: item.updatedAt.toISOString()
  };
}

function buildInventorySelect(organizationId: string) {
  return {
    ...inventoryListSelect,
    product: {
      ...inventoryListSelect.product,
      select: {
        ...inventoryListSelect.product.select,
        images: {
          ...inventoryListSelect.product.select.images,
          where: { organizationId }
        },
        mappings: {
          ...inventoryListSelect.product.select.mappings,
          where: { organizationId }
        }
      }
    }
  } satisfies Prisma.InventoryBalanceSelect;
}

export async function loadInventoryListPage(
  authContext: TenantContext,
  searchParams: URLSearchParams
) {
  const requested = parseInventoryListRequest(searchParams);
  const accountContext = await getUserAccountContext(authContext);
  const selectedBlingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;
  const scope: InventoryListScope = {
    organizationId: authContext.organizationId,
    selectedBlingConnectionId
  };
  const queryInput = { ...scope, query: requested.query };

  const [total, summaryRows, criticalIdRows] = await Promise.all([
    countInventoryList(prisma, queryInput),
    prisma.$queryRaw<InventorySummaryRow[]>(buildInventorySummaryQuery(scope)),
    prisma.$queryRaw<Array<{ id: string }>>(buildCriticalInventoryIdsQuery(scope))
  ]);
  const totalPages = Math.max(1, Math.ceil(total / requested.limit));
  const page = Math.min(requested.page, totalPages);
  const pageIds = await findInventoryListPageIds(prisma, queryInput, {
    page,
    limit: requested.limit
  });
  const criticalIds = criticalIdRows.map((row) => row.id);
  const requestedIds = [...new Set([...pageIds, ...criticalIds])];
  const records = requestedIds.length
    ? await prisma.inventoryBalance.findMany({
        where: {
          id: { in: requestedIds },
          organizationId: authContext.organizationId,
          product: { organizationId: authContext.organizationId },
          connection: { organizationId: authContext.organizationId },
          ...(selectedBlingConnectionId
            ? { connectionId: selectedBlingConnectionId }
            : {})
        },
        select: buildInventorySelect(authContext.organizationId),
        take: requestedIds.length
      })
    : [];
  const recordsById = new Map(
    records.map((record) => [record.id, serializeInventory(record)])
  );
  const data = pageIds.flatMap((id) => {
    const record = recordsById.get(id);
    return record ? [record] : [];
  });
  const criticalItems = criticalIds.flatMap((id) => {
    const record = recordsById.get(id);
    return record ? [record] : [];
  });
  const summaryRow = summaryRows[0];

  return {
    data,
    criticalItems,
    summary: {
      totalPhysical: Number(summaryRow?.totalPhysical ?? 0),
      totalReserved: Number(summaryRow?.totalReserved ?? 0),
      lowStockCount: Number(summaryRow?.lowStockCount ?? 0),
      ruptureCount: Number(summaryRow?.ruptureCount ?? 0),
      movementCount: 0,
      totalItems: Number(summaryRow?.totalItems ?? 0)
    },
    pagination: {
      page,
      limit: requested.limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    accountContext
  };
}

export type InventoryListPageData = Awaited<ReturnType<typeof loadInventoryListPage>>;
