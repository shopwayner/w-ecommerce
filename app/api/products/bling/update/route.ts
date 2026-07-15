import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import {
  blingProductUpdateRequestSchema,
  type BlingProductReviewInput
} from "@/lib/bling-product-update-schema";
import { createAuditLog, logDangerousAction } from "@/lib/services/audit-log-service";
import { blingProductUpdateService } from "@/lib/services/bling-product-update-service";

function safeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Conta Bling nao encontrada")) return { status: 404, message: "Conta Bling nao encontrada." };
  if (message.includes("Reconecte") || message.includes("reconectada") || message.includes("configurada")) {
    return { status: 409, message: "Reconecte a conta Bling para continuar." };
  }
  if (message.includes("andamento")) return { status: 409, message: "Ja existe uma atualizacao em andamento para esta conta." };
  if (message.includes("titulo") || message.includes("marca") || message.includes("fotos")) return { status: 400, message };
  return { status: 503, message: "Nao foi possivel atualizar o produto no Bling agora." };
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  if (!can(auth.context.role, "integrations:write") || (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")) {
    return NextResponse.json({ error: "Somente administradores podem atualizar produtos no Bling." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = blingProductUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise o produto e tente novamente." }, { status: 400 });
  }

  try {
    if (!parsed.data.confirmed) {
      const preview = await blingProductUpdateService.preview({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId
      });
      return NextResponse.json({ data: preview });
    }

    const fields = parsed.data.fields as BlingProductReviewInput;
    const idempotencyKey = parsed.data.idempotencyKey as string;
    await logDangerousAction({
      authContext: auth.context,
      action: "BLING_PRODUCT_UPDATE_INTENT_RECORDED",
      entityType: "Product",
      entityId: parsed.data.productId,
      route: "/api/products/bling/update",
      method: "POST",
      confirmation: true,
      status: "SUCCESS",
      riskLevel: "CRITICAL",
      summary: "Atualizacao de titulo, marca ou fotos no Bling confirmada pelo usuario.",
      metadata: {
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId,
        allowedFields: Object.keys(fields)
      },
      request,
      requirePersist: true
    });

    const result = await blingProductUpdateService.updateOne({
      organizationId: auth.context.organizationId,
      connectionId: parsed.data.connectionId,
      productId: parsed.data.productId,
      fields,
      idempotencyKey
    });

    await createAuditLog({
      authContext: auth.context,
      action: "BLING_PRODUCT_UPDATE_RESULT",
      entityType: "Product",
      entityId: parsed.data.productId,
      route: "/api/products/bling/update",
      method: "POST",
      confirmation: true,
      status: result.status === "FAILED" ? "FAILED" : "SUCCESS",
      riskLevel: "HIGH",
      summary: result.message,
      metadata: {
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId,
        externalProductIdMasked: result.externalProductIdMasked,
        fields: result.fields,
        resultCode: result.status,
        replayed: result.replayed === true
      },
      request
    });

    return NextResponse.json({ data: { item: result } });
  } catch (error) {
    const safeError = safeRouteError(error);
    return NextResponse.json({ error: safeError.message }, { status: safeError.status });
  }
}
