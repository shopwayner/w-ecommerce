import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { logDangerousAction } from "@/lib/services/audit-log-service";
import { applyGtinImportFromCsv } from "@/lib/services/gtin-import-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  if (auth.context.role !== "OWNER") {
    return NextResponse.json({ error: "Somente conta MASTER/OWNER pode importar registros no banco GTIN global." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const confirm = formData?.get("confirm");
  const conflictResolutionsRaw = formData?.get("conflictResolutions");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo CSV obrigatorio." }, { status: 400 });
  }

  try {
    const conflictResolutions =
      typeof conflictResolutionsRaw === "string" && conflictResolutionsRaw.trim()
        ? JSON.parse(conflictResolutionsRaw)
        : undefined;
    const report = await applyGtinImportFromCsv({
      csv: await file.text(),
      confirm: typeof confirm === "string" ? confirm : "",
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      conflictResolutions: Array.isArray(conflictResolutions) ? conflictResolutions : undefined
    });
    await logDangerousAction({
      authContext: auth.context,
      action: "GTIN_IMPORT_APPLY",
      entityType: "InternalGtinCatalog",
      route: "/api/gtin/import/apply",
      method: "POST",
      confirmation: confirm,
      status: "SUCCESS",
      riskLevel: "HIGH",
      summary: "Aplicacao de importacao/enriquecimento de catalogo GTIN.",
      metadata: { ...report, externalWrite: false },
      request
    });
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel aplicar a importacao GTIN.";
    await logDangerousAction({
      authContext: auth.context,
      action: "GTIN_IMPORT_APPLY",
      entityType: "InternalGtinCatalog",
      route: "/api/gtin/import/apply",
      method: "POST",
      confirmation: confirm,
      status: message.toLowerCase().includes("confirm") ? "BLOCKED" : "FAILED",
      riskLevel: "HIGH",
      summary: message.toLowerCase().includes("confirm")
        ? "Importacao GTIN bloqueada por falta de confirmacao textual."
        : "Falha ao aplicar importacao GTIN.",
      metadata: { error: message, externalWrite: false },
      request
    });
    return NextResponse.json(
      { error: message },
      { status: 400 }
    );
  }
}
