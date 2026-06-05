import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireApiAuth("pricing:read");
  if (!auth.ok) return auth.response;

  const prices = await prisma.productPrice.findMany({
    where: { organizationId: auth.context.organizationId },
    include: { product: true },
    orderBy: { updatedAt: "desc" },
    take: 50
  });

  return NextResponse.json({
    data: prices.map((price) => ({
      product: price.product.name,
      sku: price.product.sku,
      cost: price.costPrice.toString(),
      suggested: price.salePrice.toString(),
      current: price.salePrice.toString(),
      status: price.status
    }))
  });
}
