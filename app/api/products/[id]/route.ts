import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { parseDecimalPrice } from "@/lib/decimal-price";
import { normalizeProductBrand } from "@/lib/product-brand";
import {
  ProductImageUpdateValidationError,
  validateProductImageUpdate
} from "@/lib/product-image-update";
import { prisma } from "@/lib/prisma";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { productUpdateSchema } from "@/lib/validation";

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

function getAttributes(attributes: unknown) {
  return attributes && typeof attributes === "object" && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>)
    : {};
}

function getStringAttribute(attributes: Record<string, unknown>, key: string) {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseBrazilianDecimal(value: string | null | undefined, field: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return { numberValue: 0, displayValue: "0,00" };

  const numberValue = parseDecimalPrice(normalized);
  if (numberValue === null) {
    return { error: `${field} deve estar em formato numerico valido.` };
  }
  if (numberValue < 0) {
    return { error: `${field} nao pode ser negativo.` };
  }

  return { numberValue, displayValue: numberValue.toFixed(2) };
}

function formatProductResponse(product: Awaited<ReturnType<typeof loadProductForResponse>>) {
  const metadata = getMetadata(product.blockedFields);
  const attributes = getAttributes(product.attributes);
  const inventoryStock = product.inventory.reduce((total, item) => total + item.physicalQuantity - item.reservedQuantity, 0);
  const stockOverride = typeof metadata.stockOverride === "number" ? metadata.stockOverride : null;
  const currentPrice = product.prices[0];
  const blingMapping = product.mappings[0];
  const brand = normalizeProductBrand(product.brand);
  const blingAccountName =
    blingMapping?.connection.name ||
    blingMapping?.connection.externalCompanyName ||
    blingMapping?.connection.externalCompanyDocument ||
    blingMapping?.connection.externalAccountId ||
    null;

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    ean: product.ean,
    category: product.category,
    brand,
    ncm: product.ncm,
    origin: typeof metadata.origin === "string" ? metadata.origin : product.brand,
    unit: typeof metadata.unit === "string" ? metadata.unit : typeof attributes.unit === "string" ? attributes.unit : null,
    description: product.description,
    imageUrl: product.images[0]?.url ?? null,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      position: image.position
    })),
    hasEnrichmentDraft: product.enrichmentDrafts.length > 0,
    status: product.status,
    enrichmentStatus: product.enrichmentStatus,
    syncStatus: product.syncStatus,
    source: product.source,
    externalId: blingMapping?.externalProductId ?? getStringAttribute(attributes, "externalId"),
    externalProductId: blingMapping?.externalProductId ?? getStringAttribute(attributes, "externalId"),
    blingAccount: blingMapping
      ? {
          blingAccountId: blingMapping.connectionId,
          blingAccountName,
          displayName: blingAccountName,
          blingAccountShortId: blingMapping.connectionId.slice(-8),
          isActiveDefault: blingMapping.connection.isDefault,
          externalProductId: blingMapping.externalProductId,
          status: blingMapping.connection.status
        }
      : null,
    blingStatus: getStringAttribute(attributes, "blingStatus"),
    marketplaceCategories: product.marketplaceCategoryMappings.map((mapping) => ({
      provider: mapping.provider,
      status: mapping.status,
      marketplaceCategoryId: mapping.marketplaceCategoryId,
      marketplaceCategoryName: mapping.marketplaceCategoryName,
      marketplaceCategoryPath: mapping.marketplaceCategoryPath,
      confidenceScore: mapping.confidenceScore,
      requiredAttributes: mapping.requiredAttributes,
      attributeValues: mapping.productAttributeValues.map((value) => ({
        attributeId: value.attributeId,
        value: value.value,
        status: value.status
      }))
    })),
    confidenceScore: product.confidenceScore,
    weight: product.weight?.toString() ?? null,
    grossWeight: product.grossWeight?.toString() ?? null,
    height: product.height?.toString() ?? null,
    width: product.width?.toString() ?? null,
    depth: product.depth?.toString() ?? null,
    dimensionUnit: product.dimensionUnit,
    condition: product.condition,
    attributes: product.attributes,
    displayValue: typeof metadata.displayValue === "string" ? metadata.displayValue : null,
    salePriceDisplay: typeof metadata.salePriceDisplay === "string" ? metadata.salePriceDisplay : currentPrice?.salePrice.toString() ?? null,
    costPrice: currentPrice?.costPrice.toString() ?? "0",
    costPriceDisplay: currentPrice?.costPrice.toString() ?? null,
    price: currentPrice?.salePrice.toString() ?? "0",
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
      images: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } },
      mappings: {
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          connection: true
        }
      },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          productAttributeValues: {
            select: {
              attributeId: true,
              value: true,
              status: true
            }
          }
        }
      }
    }
  });
}

function toOptionalJson(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      prices: { take: 1, orderBy: { createdAt: "desc" } },
      inventory: true,
      images: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      enrichmentDrafts: { take: 1, orderBy: { updatedAt: "desc" } },
      mappings: {
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          connection: true
        }
      },
      marketplaceCategoryMappings: {
        where: { provider: "MERCADO_LIVRE" },
        take: 1,
        orderBy: { updatedAt: "desc" },
        include: {
          productAttributeValues: {
            select: {
              attributeId: true,
              value: true,
              status: true
            }
          }
        }
      }
    }
  });

  if (!product) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ data: formatProductResponse(product) });
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
      images: { orderBy: [{ position: "asc" }, { id: "asc" }] }
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  const metadata = getMetadata(existing.blockedFields);
  const imageUrl = normalizeOptionalText(parsed.data.imageUrl);
  const description = normalizeOptionalText(parsed.data.description);
  let imageUpdatePlan: ReturnType<typeof validateProductImageUpdate> | null = null;

  if (parsed.data.images) {
    try {
      imageUpdatePlan = validateProductImageUpdate({
        organizationId: auth.context.organizationId,
        productId: existing.id,
        existingImages: existing.images,
        changes: parsed.data.images
      });
    } catch (error) {
      if (error instanceof ProductImageUpdateValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          ...(parsed.data.sku !== undefined ? { sku: normalizeOptionalText(parsed.data.sku) } : {}),
          ean,
          description,
          category: normalizeOptionalText(parsed.data.category),
          status: parsed.data.status ?? existing.status,
          enrichmentStatus: parsed.data.enrichmentStatus ?? existing.enrichmentStatus,
          syncStatus: parsed.data.syncStatus ?? existing.syncStatus,
          source: normalizeOptionalText(parsed.data.source) ?? existing.source,
          confidenceScore: parsed.data.confidenceScore ?? existing.confidenceScore,
          weight: parsed.data.weight,
          height: parsed.data.height,
          width: parsed.data.width,
          depth: parsed.data.depth,
          attributes: toOptionalJson(parsed.data.attributes),
          blockedFields: {
            ...metadata,
            unit: normalizeOptionalText(parsed.data.unit),
            origin: parsed.data.origin !== undefined
              ? normalizeOptionalText(parsed.data.origin)
              : typeof metadata.origin === "string" ? metadata.origin : null,
            displayValue: displayValue.displayValue,
            salePriceDisplay: salePrice.displayValue,
            stockOverride: parsed.data.stock !== undefined
              ? parsed.data.stock
              : typeof metadata.stockOverride === "number" ? metadata.stockOverride : 0
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

      if (imageUpdatePlan) {
        if (imageUpdatePlan.removedImageIds.length) {
          await tx.productImage.deleteMany({
            where: {
              id: { in: imageUpdatePlan.removedImageIds },
              organizationId: auth.context.organizationId,
              productId: existing.id
            }
          });
        }

        await Promise.all(
          imageUpdatePlan.orderedImageIds.map((imageId, position) =>
            tx.productImage.update({
              where: { id: imageId },
              data: { position }
            })
          )
        );
      } else if (imageUrl) {
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
