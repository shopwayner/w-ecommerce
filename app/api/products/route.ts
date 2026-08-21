import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { loadProductListPage } from "@/lib/services/product-list-service";
import { productCreateSchema } from "@/lib/validation";

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

export async function GET(request: Request) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    await loadProductListPage(auth.context, new URL(request.url).searchParams)
  );
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const parsed = productCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  const ean = normalizeGtin(parsed.data.ean);
  if (!isValidGtin(ean)) {
    return NextResponse.json(
      { error: "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos." },
      { status: 400 }
    );
  }

  const product = await prisma.product.create({
    data: {
      organizationId: auth.context.organizationId,
      name: parsed.data.name,
      sku: normalizeOptionalText(parsed.data.sku),
      ean,
      description: parsed.data.description,
      brand: parsed.data.brand,
      category: parsed.data.category,
      ncm: parsed.data.ncm,
      cest: parsed.data.cest,
      enrichmentStatus: "IMPORTED",
      syncStatus: "NOT_SYNCED",
      source: "Cadastro manual",
      prices:
        parsed.data.salePrice || parsed.data.costPrice
          ? { create: { organizationId: auth.context.organizationId, salePrice: parsed.data.salePrice ?? 0, costPrice: parsed.data.costPrice ?? 0 } }
          : undefined
    }
  });

  return NextResponse.json({ data: { id: product.id, name: product.name, sku: product.sku }, status: "created" }, { status: 201 });
}
