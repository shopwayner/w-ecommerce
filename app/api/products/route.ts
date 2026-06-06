import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { productCreateSchema } from "@/lib/validation";

function getTestMetadata(blockedFields: unknown) {
  if (!blockedFields || typeof blockedFields !== "object" || Array.isArray(blockedFields)) {
    return {};
  }

  const fields = blockedFields as Record<string, unknown>;

  return {
    unit: typeof fields.unit === "string" ? fields.unit : null,
    origin: typeof fields.origin === "string" ? fields.origin : null,
    displayValue: typeof fields.displayValue === "string" ? fields.displayValue : null,
    salePriceDisplay: typeof fields.salePriceDisplay === "string" ? fields.salePriceDisplay : null,
    stockOverride: typeof fields.stockOverride === "number" ? fields.stockOverride : null
  };
}

export async function GET() {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const products = await prisma.product.findMany({
    where: { organizationId: auth.context.organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } }
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({
    data: products.map((product) => {
      const metadata = getTestMetadata(product.blockedFields);

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        ean: product.ean,
        description: product.description,
        category: product.category,
        origin: metadata.origin ?? product.brand,
        unit: metadata.unit,
        imageUrl: product.images[0]?.url ?? null,
        hasEnrichmentDraft: product.enrichmentDrafts.length > 0,
        status: product.status,
        displayValue: metadata.displayValue,
        salePriceDisplay: metadata.salePriceDisplay,
        price: product.prices[0]?.salePrice.toString() ?? "0",
        stock: product.inventory.length
          ? product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0)
          : metadata.stockOverride ?? 0,
        updatedAt: product.updatedAt
      };
    })
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
