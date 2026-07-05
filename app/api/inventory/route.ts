import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";

function statusFromQuantities(availableQuantity: number, minQuantity: number | null) {
  if (availableQuantity <= 0) return "RUPTURE";
  if (minQuantity !== null && availableQuantity <= minQuantity) return "LOW_STOCK";
  return "OK";
}

export async function GET() {
  const auth = await requireApiAuth("inventory:read");
  if (!auth.ok) return auth.response;

  const accountContext = await getUserAccountContext(auth.context);
  const selectedBlingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const inventory = await prisma.inventoryBalance.findMany({
    where: {
      organizationId: auth.context.organizationId,
      ...(selectedBlingConnectionId ? { connectionId: selectedBlingConnectionId } : {})
    },
    include: {
      connection: true,
      product: {
        include: {
          images: { take: 1, orderBy: { position: "asc" } },
          mappings: {
            where: selectedBlingConnectionId ? { connectionId: selectedBlingConnectionId } : undefined,
            include: { connection: true },
            orderBy: { updatedAt: "desc" }
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  const data = inventory.map((item) => {
    const mapping =
      item.product.mappings.find((productMapping) => productMapping.connectionId === item.connectionId) ??
      item.product.mappings[0] ??
      null;
    const safetyStock = item.safetyQuantity;
    const availableQuantity = item.physicalQuantity - item.reservedQuantity - safetyStock;
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
      updatedAt: item.updatedAt
    };
  });

  const summary = data.reduce(
    (acc, item) => {
      acc.totalPhysical += item.physicalQuantity;
      acc.totalReserved += item.reservedQuantity;
      if (item.status === "LOW_STOCK") acc.lowStockCount += 1;
      if (item.status === "RUPTURE") acc.ruptureCount += 1;
      return acc;
    },
    {
      totalPhysical: 0,
      totalReserved: 0,
      lowStockCount: 0,
      ruptureCount: 0,
      movementCount: 0,
      totalItems: data.length
    }
  );

  return NextResponse.json({ data, summary, accountContext });
}
