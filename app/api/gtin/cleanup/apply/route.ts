import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { ConfirmationError, requireConfirmation } from "@/lib/security/confirmation";
import { applyGlobalGtinCleanup } from "@/lib/services/internal-gtin-catalog-service";
import { logDangerousAction } from "@/lib/services/audit-log-service";

const confirmationText = "DELETE_GTINS_WITHOUT_IMAGE_FROM_GLOBAL_CATALOG";
const cleanupMode = "KEEP_ONLY_WITH_IMAGE";

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { mode?: unknown; confirm?: unknown };

  if (auth.context.role !== "OWNER") {
    return NextResponse.json({ error: "Somente conta MASTER/OWNER pode limpar o banco GTIN global." }, { status: 403 });
  }

  if (body.mode !== cleanupMode) {
    return NextResponse.json({ error: "Modo de limpeza invalido.", requiredMode: cleanupMode }, { status: 400 });
  }

  try {
    requireConfirmation(body.confirm, confirmationText);
  } catch (error) {
    if (error instanceof ConfirmationError) {
      await logDangerousAction({
        authContext: auth.context,
        action: "GTIN_GLOBAL_CATALOG_CLEANUP",
        entityType: "InternalGtinCatalog",
        route: "/api/gtin/cleanup/apply",
        method: "POST",
        confirmation: body.confirm,
        status: "BLOCKED",
        riskLevel: "HIGH",
        summary: "Limpeza do banco GTIN global bloqueada por falta de confirmacao textual.",
        metadata: {
          mode: body.mode,
          productWrite: false,
          draftWrite: false,
          externalMappingWrite: false,
          externalWrite: false
        },
        request
      });
      return NextResponse.json(
        {
          error: "Confirmacao textual obrigatoria para limpar GTINs sem imagem.",
          requiredConfirm: error.requiredConfirm
        },
        { status: 409 }
      );
    }
    throw error;
  }

  const report = await applyGlobalGtinCleanup({
    organizationId: auth.context.organizationId,
    userId: auth.context.user.id
  });

  await logDangerousAction({
    authContext: auth.context,
    action: "GTIN_GLOBAL_CATALOG_CLEANUP",
    entityType: "InternalGtinCatalog",
    route: "/api/gtin/cleanup/apply",
    method: "POST",
    confirmation: body.confirm,
    status: "SUCCESS",
    riskLevel: "HIGH",
    summary: "Limpeza segura do banco GTIN global concluida.",
    metadata: {
      mode: report.mode,
      before: {
        totalGtins: report.before.totalGtins,
        keepWithImage: report.before.keepWithImage,
        removeWithoutImage: report.before.removeWithoutImage
      },
      deleted: report.deleted,
      after: {
        totalGtins: report.after.totalGtins,
        keepWithImage: report.after.keepWithImage,
        removeWithoutImage: report.after.removeWithoutImage
      },
      productWrite: false,
      draftWrite: false,
      externalMappingWrite: false,
      externalWrite: false
    },
    request
  });

  return NextResponse.json(report);
}
