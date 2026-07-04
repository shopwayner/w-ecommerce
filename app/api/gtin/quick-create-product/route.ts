import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { ConfirmationError, requireConfirmation } from "@/lib/security/confirmation";
import { logDangerousAction } from "@/lib/services/audit-log-service";
import { findByGtin, isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";

const confirmationText = "CREATE_PRODUCT_FROM_INTERNAL_GTIN";

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function imageUrlsFromJson(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fields = item as Record<string, unknown>;
        return typeof fields.url === "string" ? fields.url : typeof fields.src === "string" ? fields.src : null;
      }
      return null;
    })
    .filter((url): url is string => Boolean(url));
}

function jsonInput(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { gtin?: unknown; confirm?: unknown };
  const gtin = typeof body.gtin === "string" ? body.gtin : "";
  const normalizedGtin = normalizeGtin(gtin);

  try {
    requireConfirmation(body.confirm, confirmationText);
  } catch (error) {
    if (error instanceof ConfirmationError) {
      await logDangerousAction({
        authContext: auth.context,
        action: "GTIN_QUICK_CREATE_PRODUCT",
        entityType: "Product",
        route: "/api/gtin/quick-create-product",
        method: "POST",
        confirmation: body.confirm,
        status: "BLOCKED",
        riskLevel: "HIGH",
        summary: "Criacao de produto via GTIN interno bloqueada por falta de confirmacao textual.",
        metadata: { normalizedGtin, externalWrite: false },
        request
      });
      return NextResponse.json(
        {
          error: "Confirmacao obrigatoria para criar produto interno a partir do catalogo GTIN.",
          requiredConfirm: error.requiredConfirm
        },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!normalizedGtin || !isValidGtin(normalizedGtin)) {
    return NextResponse.json({ error: "GTIN/EAN invalido." }, { status: 400 });
  }

  const catalog = await findByGtin(normalizedGtin);
  if (!catalog) {
    return NextResponse.json({ error: "GTIN nao encontrado na base interna." }, { status: 404 });
  }

  const existing = await prisma.product.findFirst({
    where: {
      organizationId: auth.context.organizationId,
      ean: normalizedGtin
    },
    select: { id: true, name: true, sku: true, ean: true, status: true }
  });

  if (existing) {
    return NextResponse.json({
      status: "existing",
      productId: existing.id,
      product: existing,
      message: "Ja existe um produto com este GTIN nesta organizacao.",
      externalWrite: false
    });
  }

  const imageUrls = imageUrlsFromJson(catalog.imagesJson);
  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        organizationId: auth.context.organizationId,
        name: catalog.optimizedTitle || catalog.title,
        sku: null,
        ean: normalizedGtin,
        description: normalizeOptionalText(catalog.descriptionFull ?? catalog.descriptionShort ?? catalog.technicalDescription),
        brand: normalizeOptionalText(catalog.brand),
        category: normalizeOptionalText(catalog.category),
        status: "DRAFT",
        enrichmentStatus: catalog.confidenceScore >= 80 ? "ENRICHED" : "AWAITING_ENRICHMENT",
        syncStatus: "NOT_SYNCED",
        source: "INTERNAL_GTIN_CATALOG",
        confidenceScore: catalog.confidenceScore,
        weight: catalog.weight,
        height: catalog.height,
        width: catalog.width,
        depth: catalog.depth,
        attributes: jsonInput(catalog.attributesJson),
        images: imageUrls.length
          ? {
              create: imageUrls.slice(0, 8).map((url, position) => ({
                organizationId: auth.context.organizationId,
                url,
                position
              }))
            }
          : undefined
      }
    });

    return created;
  });

  await logDangerousAction({
    authContext: auth.context,
    action: "GTIN_QUICK_CREATE_PRODUCT",
    entityType: "Product",
    entityId: product.id,
    route: "/api/gtin/quick-create-product",
    method: "POST",
    confirmation: body.confirm,
    status: "SUCCESS",
    riskLevel: "HIGH",
    summary: "Produto interno criado a partir do catalogo GTIN interno.",
    metadata: {
      normalizedGtin,
      catalogId: catalog.id,
      source: "INTERNAL_GTIN_CATALOG",
      externalWrite: false
    },
    request
  });

  return NextResponse.json(
    {
      status: "created",
      productId: product.id,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        ean: product.ean,
        status: product.status,
        source: product.source,
        syncStatus: product.syncStatus
      },
      externalWrite: false
    },
    { status: 201 }
  );
}
