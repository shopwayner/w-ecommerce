import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { productCreateSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const products = await prisma.product.findMany({
    where: { organizationId: auth.context.organizationId },
    include: { prices: { take: 1, orderBy: { createdAt: "desc" } }, inventory: true },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({
    data: products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      ean: product.ean,
      category: product.category,
      status: product.status,
      price: product.prices[0]?.salePrice.toString() ?? "0",
      stock: product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0),
      updatedAt: product.updatedAt
    }))
  });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = productCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const product = await prisma.product.create({
    data: {
      organizationId: auth.context.organizationId,
      name: parsed.data.name,
      sku: parsed.data.sku,
      ean: parsed.data.ean,
      description: parsed.data.description,
      brand: parsed.data.brand,
      category: parsed.data.category,
      ncm: parsed.data.ncm,
      cest: parsed.data.cest,
      prices:
        parsed.data.salePrice || parsed.data.costPrice
          ? { create: { organizationId: auth.context.organizationId, salePrice: parsed.data.salePrice ?? 0, costPrice: parsed.data.costPrice ?? 0 } }
          : undefined
    }
  });

  return NextResponse.json({ data: { id: product.id, name: product.name, sku: product.sku }, status: "created" }, { status: 201 });
}
