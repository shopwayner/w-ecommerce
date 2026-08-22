import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { parseDecimalPrice } from "@/lib/decimal-price";
import { normalizeProductBrand } from "@/lib/product-brand";
import {
  ProductImageUpdateValidationError,
  validateProductImageUpdate
} from "@/lib/product-image-update";
import {
  ProductImageUrlValidationError,
  validateProductImageUrlsForPersistence
} from "@/lib/product-image-url-validation";
import { prisma } from "@/lib/prisma";
import { getUserAccountContext } from "@/lib/services/account-context-service";
import {
  findProductDetails,
  loadProductDetails
} from "@/lib/services/product-details-service";
import { isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { normalizeProductDescriptionForStorage } from "@/lib/product-description";
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

function toOptionalJson(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await loadProductDetails(auth.context, id);

  if (!result) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ data: result.data, permissions: result.permissions });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  const accountContext = await getUserAccountContext(auth.context);
  const blingConnectionId =
    accountContext.mode === "ERP_ACCOUNT" && accountContext.provider === "BLING"
      ? accountContext.connectionId
      : null;

  const { id } = await params;
  const body = await request.json();
  const parsed = productUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  let ean: string | null | undefined;
  if (parsed.data.ean !== undefined) {
    const rawEan = parsed.data.ean?.trim() ?? "";
    if (rawEan && !/^\d+$/.test(rawEan)) {
      return NextResponse.json(
        { error: "GTIN/EAN invalido. Informe somente digitos." },
        { status: 400 }
      );
    }
    ean = normalizeGtin(rawEan);
    if (!isValidGtin(ean)) {
      return NextResponse.json(
        { error: "GTIN/EAN invalido. Informe 8, 12, 13 ou 14 digitos validos." },
        { status: 400 }
      );
    }
  }

  const displayValue = parsed.data.displayValue !== undefined
    ? parseBrazilianDecimal(parsed.data.displayValue, "Valor")
    : null;
  if (displayValue && "error" in displayValue) {
    return NextResponse.json({ error: displayValue.error }, { status: 400 });
  }

  const salePrice = parsed.data.salePriceDisplay !== undefined
    ? parseBrazilianDecimal(parsed.data.salePriceDisplay, "Preco de venda")
    : null;
  if (salePrice && "error" in salePrice) {
    return NextResponse.json({ error: salePrice.error }, { status: 400 });
  }

  let brand: string | null | undefined;
  if (parsed.data.brand !== undefined) {
    const brandText = normalizeOptionalText(parsed.data.brand);
    brand = brandText === null ? null : normalizeProductBrand(brandText);
    if (brandText && !brand) {
      return NextResponse.json({ error: "Informe uma marca valida ou deixe o campo vazio." }, { status: 400 });
    }
  }

  const existing = await prisma.product.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    include: {
      prices: {
        where: { organizationId: auth.context.organizationId },
        take: 1,
        orderBy: { createdAt: "desc" }
      },
      inventory: {
        where: {
          organizationId: auth.context.organizationId,
          ...(blingConnectionId ? { connectionId: blingConnectionId } : {})
        }
      },
      images: {
        where: { organizationId: auth.context.organizationId },
        orderBy: [{ position: "asc" }, { id: "asc" }]
      }
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }

  const metadata = getMetadata(existing.blockedFields);
  const imageUrl = normalizeOptionalText(parsed.data.imageUrl);
  const description = parsed.data.description === undefined
    ? undefined
    : normalizeProductDescriptionForStorage(parsed.data.description);
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

  if (imageUpdatePlan?.newImageUrls.length) {
    try {
      await validateProductImageUrlsForPersistence(imageUpdatePlan.newImageUrls);
    } catch (error) {
      if (error instanceof ProductImageUrlValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const productData: Prisma.ProductUpdateInput = {};
      if (parsed.data.name !== undefined) productData.name = parsed.data.name;
      if (brand !== undefined) productData.brand = brand;
      if (parsed.data.sku !== undefined) productData.sku = normalizeOptionalText(parsed.data.sku);
      if (ean !== undefined) productData.ean = ean;
      if (description !== undefined) productData.description = description;
      if (parsed.data.category !== undefined) productData.category = normalizeOptionalText(parsed.data.category);
      if (parsed.data.status !== undefined) productData.status = parsed.data.status;
      if (parsed.data.enrichmentStatus !== undefined) productData.enrichmentStatus = parsed.data.enrichmentStatus;
      if (parsed.data.syncStatus !== undefined) productData.syncStatus = parsed.data.syncStatus;
      if (parsed.data.source !== undefined) productData.source = normalizeOptionalText(parsed.data.source);
      if (parsed.data.confidenceScore !== undefined) productData.confidenceScore = parsed.data.confidenceScore;
      if (parsed.data.weight !== undefined) productData.weight = parsed.data.weight;
      if (parsed.data.grossWeight !== undefined) productData.grossWeight = parsed.data.grossWeight;
      if (parsed.data.height !== undefined) productData.height = parsed.data.height;
      if (parsed.data.width !== undefined) productData.width = parsed.data.width;
      if (parsed.data.depth !== undefined) productData.depth = parsed.data.depth;
      if (parsed.data.dimensionUnit !== undefined) productData.dimensionUnit = parsed.data.dimensionUnit;
      if (parsed.data.condition !== undefined) productData.condition = parsed.data.condition;
      if (parsed.data.format !== undefined) productData.format = parsed.data.format;
      if (parsed.data.productType !== undefined) productData.productType = parsed.data.productType;
      if (parsed.data.commercialStatus !== undefined) productData.commercialStatus = parsed.data.commercialStatus;
      if (parsed.data.productionType !== undefined) productData.productionType = parsed.data.productionType;
      if (parsed.data.expirationDate !== undefined) {
        productData.expirationDate = parsed.data.expirationDate
          ? new Date(`${parsed.data.expirationDate}T00:00:00.000Z`)
          : null;
      }
      if (parsed.data.freeShipping !== undefined) productData.freeShipping = parsed.data.freeShipping;
      if (parsed.data.volumes !== undefined) productData.volumes = parsed.data.volumes;
      if (parsed.data.itemsPerBox !== undefined) productData.itemsPerBox = parsed.data.itemsPerBox;
      if (parsed.data.packagingGtin !== undefined) productData.packagingGtin = parsed.data.packagingGtin;
      if (parsed.data.attributes !== undefined) productData.attributes = toOptionalJson(parsed.data.attributes);

      const metadataChanged = parsed.data.unit !== undefined
        || parsed.data.origin !== undefined
        || displayValue !== null
        || salePrice !== null
        || parsed.data.stock !== undefined;
      if (metadataChanged) {
        productData.blockedFields = {
          ...metadata,
          ...(parsed.data.unit !== undefined ? { unit: normalizeOptionalText(parsed.data.unit) } : {}),
          ...(parsed.data.origin !== undefined ? { origin: normalizeOptionalText(parsed.data.origin) } : {}),
          ...(displayValue && !("error" in displayValue) ? { displayValue: displayValue.displayValue } : {}),
          ...(salePrice && !("error" in salePrice) ? { salePriceDisplay: salePrice.displayValue } : {}),
          ...(parsed.data.stock !== undefined ? { stockOverride: parsed.data.stock } : {})
        } as Prisma.InputJsonValue;
      }

      if (Object.keys(productData).length > 0) {
        await tx.product.update({ where: { id: existing.id }, data: productData });
      }

      if (displayValue !== null || salePrice !== null) {
        const costPrice = displayValue && !("error" in displayValue)
          ? displayValue.numberValue
          : Number(existing.prices[0]?.costPrice ?? 0);
        const nextSalePrice = salePrice && !("error" in salePrice)
          ? salePrice.numberValue
          : Number(existing.prices[0]?.salePrice ?? 0);
        if (existing.prices[0]) {
          await tx.productPrice.update({
            where: { id: existing.prices[0].id },
            data: {
              ...(displayValue !== null ? { costPrice } : {}),
              ...(salePrice !== null ? { salePrice: nextSalePrice } : {}),
              status: "ACTIVE"
            }
          });
        } else {
          await tx.productPrice.create({
            data: {
              organizationId: auth.context.organizationId,
              productId: existing.id,
              costPrice,
              salePrice: nextSalePrice,
              status: "ACTIVE"
            }
          });
        }
      }

      if (blingConnectionId && existing.inventory[0] && parsed.data.stock !== undefined) {
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

        await Promise.all(imageUpdatePlan.orderedImages.map((image, position) => {
          if (image.kind === "existing") {
            return tx.productImage.update({ where: { id: image.id }, data: { position } });
          }
          return tx.productImage.create({
            data: {
              organizationId: auth.context.organizationId,
              productId: existing.id,
              url: image.url,
              position
            }
          });
        }));
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

  const updatedProduct = await findProductDetails({
    productId: existing.id,
    organizationId: auth.context.organizationId,
    blingConnectionId
  });
  if (!updatedProduct) {
    return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  }
  return NextResponse.json({ data: updatedProduct, status: "updated" });
}
