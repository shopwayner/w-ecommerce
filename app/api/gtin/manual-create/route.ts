import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { ConfirmationError, requireConfirmation } from "@/lib/security/confirmation";
import { createCatalogEntry, findByGtin, isValidGtin, normalizeGtin } from "@/lib/services/internal-gtin-catalog-service";
import { logDangerousAction } from "@/lib/services/audit-log-service";

const confirmationText = "CREATE_GLOBAL_GTIN_RECORD";

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const normalizedGtin = normalizeGtin(optionalText(body.gtin));

  if (auth.context.role !== "OWNER") {
    return NextResponse.json({ error: "Somente conta MASTER/OWNER pode cadastrar GTIN global." }, { status: 403 });
  }

  try {
    requireConfirmation(body.confirm, confirmationText);
  } catch (error) {
    if (error instanceof ConfirmationError) {
      await logDangerousAction({
        authContext: auth.context,
        action: "GTIN_MANUAL_CREATE",
        entityType: "InternalGtinCatalog",
        route: "/api/gtin/manual-create",
        method: "POST",
        confirmation: body.confirm,
        status: "BLOCKED",
        riskLevel: "HIGH",
        summary: "Cadastro manual de GTIN global bloqueado por falta de confirmacao textual.",
        metadata: { normalizedGtin, externalWrite: false, productWrite: false },
        request
      });
      return NextResponse.json(
        { error: "Confirmacao textual obrigatoria para cadastrar GTIN global.", requiredConfirm: error.requiredConfirm },
        { status: 409 }
      );
    }
    throw error;
  }

  if (!normalizedGtin || !isValidGtin(normalizedGtin)) {
    return NextResponse.json({ error: "GTIN/EAN invalido." }, { status: 400 });
  }

  const title = optionalText(body.name) ?? optionalText(body.title);
  if (!title) {
    return NextResponse.json({ error: "Nome do produto e obrigatorio." }, { status: 400 });
  }

  const existing = await findByGtin(normalizedGtin);
  if (existing) {
    return NextResponse.json({ error: "GTIN ja existe no banco global.", normalizedGtin, existingId: existing.id }, { status: 409 });
  }

  const imageUrl = optionalText(body.imageUrl);
  const entry = await createCatalogEntry({
    gtin: normalizedGtin,
    title,
    optimizedTitle: title,
    brand: optionalText(body.brand),
    category: optionalText(body.category),
    descriptionShort: optionalText(body.description),
    descriptionFull: optionalText(body.description),
    imageUrl,
    imagesJson: imageUrl ? [imageUrl] : undefined,
    ncm: optionalText(body.ncm),
    unit: optionalText(body.unit),
    weight: optionalNumber(body.weight),
    height: optionalNumber(body.height),
    width: optionalNumber(body.width),
    depth: optionalNumber(body.depth),
    source: "MANUAL",
    confidenceScore: imageUrl ? 80 : 65,
    approved: true,
    organizationId: auth.context.organizationId,
    userId: auth.context.user.id
  });

  await logDangerousAction({
    authContext: auth.context,
    action: "GTIN_MANUAL_CREATE",
    entityType: "InternalGtinCatalog",
    entityId: entry.id,
    route: "/api/gtin/manual-create",
    method: "POST",
    confirmation: body.confirm,
    status: "SUCCESS",
    riskLevel: "HIGH",
    summary: "GTIN global cadastrado manualmente.",
    metadata: { normalizedGtin, source: "MANUAL", externalWrite: false, productWrite: false },
    request
  });

  return NextResponse.json({ entry, externalWrite: false, productWrite: false }, { status: 201 });
}
