import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { productUpdateSchema } from "@/lib/validation";

const gtinLengths = new Set([8, 12, 13, 14]);

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function getMetadata(blockedFields: unknown) {
  return blockedFields && typeof blockedFields === "object" && !Array.isArray(blockedFields)
    ? (blockedFields as Record<string, unknown>)
    : {};
}

function normalizeGtin(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized.replace(/\D/g, "");
}

function isValidGtin(value: string | null) {
  if (!value) return true;
  if (!gtinLengths.has(value.length)) return false;

  const digits = value.split("").map(Number);
  if (digits.some((digit) => Number.isNaN(digit))) return false;

  const checkDigit = digits.at(-1);
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return checkDigit === expected;
}

function parseBrazilianDecimal(value: string | null | undefined, field: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return { numberValue: 0, displayValue: "0,00" };

  const compact = normalized.replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(compact)) {
    return { error: `${field} deve estar em formato numerico valido.` };
  }

  const numberValue = Number(compact.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return { error: `${field} nao pode ser negativo.` };
  }

  return { numberValue, displayValue: compact };
}

function formatProductResponse(product: Awaited<ReturnType<typeof loadProductForResponse>>) {
  const metadata = getMetadata(product.blockedFields);
  const inventoryStock = product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0);
  const stockOverride = typeof metadata.stockOverride === "number" ? metadata.stockOverride : null;

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    ean: product.ean,
    category: product.category,
    origin: typeof metadata.origin === "string" ? metadata.origin : product.brand,
    unit: typeof metadata.unit === "string" ? metadata.unit : null,
    description: product.description,
    imageUrl: product.images[0]?.url ?? null,
    hasEnrichmentDraft: product.enrichmentDrafts.length > 0,
    status: product.status,
    displayValue: typeof metadata.displayValue === "string" ? metadata.displayValue : null,
    salePriceDisplay: typeof metadata.salePriceDisplay === "string" ? metadata.salePriceDisplay : null,
    price: product.prices[0]?.salePrice.toString() ?? "0",
    stock: product.inventory.length ? inventoryStock : stockOverride ?? inventoryStock,
    updatedAt: product.updatedAt
  };
}

function loadProductForResponse(productId: string, organizationId: string) {
  return prisma.product.findFirstOrThrow({
    where: { id: productId, organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } }
    }
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await request.json();
  const parsed = productUpdateSchema.safeParse(body);

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

  const displayValue = parseBrazilianDecimal(parsed.data.displayValue, "Valor");
  if ("error" in displayValue) return NextResponse.json({ error: displayValue.error }, { status: 400 });

  const salePrice = parseBrazilianDecimal(parsed.data.salePriceDisplay, "Preco de venda");
  if ("error" in salePrice) return NextResponse.json({ error: salePrice.error }, { status: 400 });

  const existing = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { take: 1, orderBy: { position: "asc" } }
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  const metadata = getMetadata(existing.blockedFields);
  const imageUrl = normalizeOptionalText(parsed.data.imageUrl);
  const description = normalizeOptionalText(parsed.data.description);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          sku: parsed.data.sku,
          ean,
          description,
          category: normalizeOptionalText(parsed.data.category),
          brand: normalizeOptionalText(parsed.data.origin),
          status: parsed.data.status ?? existing.status,
          blockedFields: {
            ...metadata,
            unit: normalizeOptionalText(parsed.data.unit),
            origin: normalizeOptionalText(parsed.data.origin),
            displayValue: displayValue.displayValue,
            salePriceDisplay: salePrice.displayValue,
            stockOverride: parsed.data.stock ?? 0
          }
        }
      });

      if (existing.prices[0]) {
        await tx.productPrice.update({
          where: { id: existing.prices[0].id },
          data: { salePrice: salePrice.numberValue, costPrice: displayValue.numberValue, status: "ACTIVE" }
        });
      } else {
        await tx.productPrice.create({
          data: {
            organizationId: auth.context.organizationId,
            productId: existing.id,
            costPrice: displayValue.numberValue,
            salePrice: salePrice.numberValue,
            status: "ACTIVE"
          }
        });
      }

      if (existing.inventory[0] && parsed.data.stock !== undefined) {
        await tx.inventoryBalance.update({
          where: { id: existing.inventory[0].id },
          data: { physicalQuantity: parsed.data.stock, reservedQuantity: 0 }
        });
      }

      if (imageUrl) {
        if (existing.images[0]) {
          await tx.productImage.update({ where: { id: existing.images[0].id }, data: { url: imageUrl } });
        } else {
          await tx.productImage.create({
            data: { organizationId: auth.context.organizationId, productId: existing.id, url: imageUrl, position: 0 }
          });
        }
      } else if (imageUrl === null && existing.images[0]) {
        await tx.productImage.delete({ where: { id: existing.images[0].id } });
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Ja existe um produto com este SKU nesta organizacao." }, { status: 409 });
    }

    return NextResponse.json({ error: "Nao foi possivel salvar o produto." }, { status: 500 });
  }

  const updatedProduct = await loadProductForResponse(existing.id, auth.context.organizationId);
  return NextResponse.json({ data: formatProductResponse(updatedProduct), status: "updated" });
}
