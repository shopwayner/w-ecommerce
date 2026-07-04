import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { ConfirmationError, requireConfirmation } from "@/lib/security/confirmation";
import { logDangerousAction } from "@/lib/services/audit-log-service";
import { updateCatalogEntry } from "@/lib/services/internal-gtin-catalog-service";
import { internalGtinCatalogSchema } from "@/lib/validation";

const confirmationText = "UPDATE_GLOBAL_GTIN_RECORD";

function cleanHtmlText(value: string | null | undefined) {
  if (!value) return null;
  const withoutDangerousBlocks = value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutDangerousBlocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  const text = withBreaks
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text || null;
}

function nullableText(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text ? text : null;
}

async function findExistingGtin(id: string) {
  return prisma.internalGtinCatalog.findUnique({ where: { id } });
}

function patchBodyToCatalogInput(body: Record<string, unknown>, existing: NonNullable<Awaited<ReturnType<typeof findExistingGtin>>>) {
  const name = nullableText(body.name);
  const title = typeof name === "string" ? name : typeof body.title === "string" ? body.title : existing.title;
  const optimizedTitle = typeof name === "string" ? name : typeof body.optimizedTitle === "string" ? body.optimizedTitle : existing.optimizedTitle;
  const imageUrl = nullableText(body.imageUrl);
  const description = cleanHtmlText(typeof body.description === "string" ? body.description : undefined);
  const descriptionShortSource = cleanHtmlText(typeof body.descriptionShort === "string" ? body.descriptionShort : undefined) ?? description;
  const descriptionShort = descriptionShortSource ? descriptionShortSource.slice(0, 500) : null;
  const descriptionFull = cleanHtmlText(typeof body.descriptionFull === "string" ? body.descriptionFull : undefined) ?? description;

  return {
    gtin: typeof body.gtin === "string" ? body.gtin : existing.gtin,
    title,
    optimizedTitle,
    brand: nullableText(body.brand) ?? existing.brand,
    category: nullableText(body.category) ?? existing.category,
    descriptionShort: descriptionShort ?? existing.descriptionShort,
    descriptionFull: descriptionFull ?? existing.descriptionFull,
    technicalDescription: cleanHtmlText(typeof body.technicalDescription === "string" ? body.technicalDescription : undefined) ?? existing.technicalDescription,
    imageUrl: typeof imageUrl === "string" ? imageUrl : existing.imageUrl,
    unit: nullableText(body.unit) ?? existing.unit,
    ncm: nullableText(body.ncm) ?? existing.ncm,
    weight: body.weight === "" || body.weight === null || body.weight === undefined ? existing.weight?.toString() ?? null : body.weight,
    height: body.height === "" || body.height === null || body.height === undefined ? existing.height?.toString() ?? null : body.height,
    width: body.width === "" || body.width === null || body.width === undefined ? existing.width?.toString() ?? null : body.width,
    depth: body.depth === "" || body.depth === null || body.depth === undefined ? existing.depth?.toString() ?? null : body.depth,
    attributesJson: existing.attributesJson,
    imagesJson: typeof imageUrl === "string" ? [imageUrl] : existing.imagesJson,
    source: existing.source,
    sourceUrl: existing.sourceUrl,
    confidenceScore: body.confidenceScore ?? existing.confidenceScore,
    approved: typeof body.approved === "boolean" ? body.approved : existing.approved
  };
}

export async function updateGlobalGtinRecord(request: Request, id: string, route: string) {
  const auth = await requireApiAuth("products:read");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (auth.context.role !== "OWNER") {
    await logDangerousAction({
      authContext: auth.context,
      action: "GTIN_GLOBAL_RECORD_UPDATE",
      entityType: "InternalGtinCatalog",
      entityId: id,
      route,
      method: "PATCH",
      confirmation: body.confirm,
      status: "BLOCKED",
      riskLevel: "HIGH",
      summary: "Edicao de GTIN global bloqueada para usuario nao OWNER.",
      metadata: { externalWrite: false, productWrite: false, reason: "OWNER_REQUIRED" },
      request
    });
    return NextResponse.json({ error: "Somente conta MASTER/OWNER pode editar o banco GTIN global." }, { status: 403 });
  }

  try {
    requireConfirmation(body.confirm, confirmationText);
  } catch (error) {
    if (error instanceof ConfirmationError) {
      await logDangerousAction({
        authContext: auth.context,
        action: "GTIN_GLOBAL_RECORD_UPDATE",
        entityType: "InternalGtinCatalog",
        entityId: id,
        route,
        method: "PATCH",
        confirmation: body.confirm,
        status: "BLOCKED",
        riskLevel: "HIGH",
        summary: "Edicao de GTIN global bloqueada por falta de confirmacao textual.",
        metadata: { externalWrite: false, productWrite: false },
        request
      });
      return NextResponse.json(
        { error: "Confirmacao textual obrigatoria para editar GTIN global.", requiredConfirm: error.requiredConfirm },
        { status: 409 }
      );
    }
    throw error;
  }

  const existing = await findExistingGtin(id);
  if (!existing) {
    return NextResponse.json({ error: "Registro de GTIN nao encontrado." }, { status: 404 });
  }

  const parsed = internalGtinCatalogSchema.safeParse(patchBodyToCatalogInput(body, existing));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const entry = await updateCatalogEntry(id, {
      ...parsed.data,
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    await logDangerousAction({
      authContext: auth.context,
      action: "GTIN_GLOBAL_RECORD_UPDATE",
      entityType: "InternalGtinCatalog",
      entityId: entry.id,
      route,
      method: "PATCH",
      confirmation: body.confirm,
      status: "SUCCESS",
      riskLevel: "HIGH",
      summary: "Registro GTIN global atualizado por OWNER.",
      metadata: {
        normalizedGtin: entry.normalizedGtin,
        approved: entry.approved,
        confidenceScore: entry.confidenceScore,
        externalWrite: false,
        productWrite: false
      },
      request
    });
    return NextResponse.json({ data: entry, status: "updated", externalWrite: false, productWrite: false });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Ja existe um registro para este GTIN normalizado." }, { status: 409 });
    }

    const message = error instanceof Error ? error.message : "Nao foi possivel atualizar o registro.";
    await logDangerousAction({
      authContext: auth.context,
      action: "GTIN_GLOBAL_RECORD_UPDATE",
      entityType: "InternalGtinCatalog",
      entityId: id,
      route,
      method: "PATCH",
      confirmation: body.confirm,
      status: "FAILED",
      riskLevel: "HIGH",
      summary: "Falha ao atualizar registro GTIN global.",
      metadata: { error: message, externalWrite: false, productWrite: false },
      request
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
