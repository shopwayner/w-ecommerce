import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import { createAuditLog, logDangerousAction } from "@/lib/services/audit-log-service";
import {
  BLING_PRODUCT_UPDATE_FIELDS,
  blingProductUpdateService,
  type BlingProductUpdateResult
} from "@/lib/services/bling-product-update-service";

const requestSchema = z.object({
  connectionId: z.string().trim().min(1).max(100),
  productIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  fields: z.array(z.enum(BLING_PRODUCT_UPDATE_FIELDS)).min(1).max(BLING_PRODUCT_UPDATE_FIELDS.length),
  confirmed: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9:_-]+$/).optional()
});

function safeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Conta Bling nao encontrada")) {
    return { status: 404, message: "Conta Bling nao encontrada." };
  }
  if (message.includes("reconectada") || message.includes("configurada")) {
    return { status: 409, message };
  }
  if (message.includes("andamento")) {
    return { status: 409, message: "Ja existe uma atualizacao de produtos em andamento para esta conta." };
  }
  return { status: 503, message: "Nao foi possivel atualizar os produtos no Bling agora." };
}

function summarizeResults(items: BlingProductUpdateResult[]) {
  return {
    selected: items.length,
    updated: items.filter((item) => item.status === "UPDATED").length,
    unchanged: items.filter((item) => item.status === "UNCHANGED").length,
    failed: items.filter((item) => item.status === "FAILED").length
  };
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  if (
    !can(auth.context.role, "integrations:write") ||
    (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")
  ) {
    return NextResponse.json({ error: "Somente administradores podem atualizar produtos no Bling." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Revise os produtos selecionados e tente novamente." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os produtos selecionados e tente novamente." }, { status: 400 });
  }

  const productIds = [...new Set(parsed.data.productIds)];
  const fields = [...new Set(parsed.data.fields)];
  try {
    if (!parsed.data.confirmed) {
      const preview = await blingProductUpdateService.preview({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productIds,
        fields
      });
      return NextResponse.json({ data: preview });
    }

    if (!parsed.data.idempotencyKey) {
      return NextResponse.json({ error: "Confirme novamente esta atualizacao antes de continuar." }, { status: 400 });
    }

    const items: BlingProductUpdateResult[] = [];
    for (const [index, productId] of productIds.entries()) {
      const itemKey = productIds.length === 1
        ? parsed.data.idempotencyKey
        : `${parsed.data.idempotencyKey}:${index + 1}`;
      await logDangerousAction({
        authContext: auth.context,
        action: "BLING_PRODUCT_UPDATE_INTENT_RECORDED",
        entityType: "Product",
        entityId: productId,
        route: "/api/products/bling/update",
        method: "POST",
        confirmation: true,
        status: "SUCCESS",
        riskLevel: "CRITICAL",
        summary: "Atualizacao cadastral de produto no Bling confirmada pelo usuario.",
        metadata: {
          connectionId: parsed.data.connectionId,
          productId,
          fields
        },
        request,
        requirePersist: true
      });

      const result = await blingProductUpdateService.updateOne({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productId,
        fields,
        idempotencyKey: itemKey
      });
      items.push(result);

      await createAuditLog({
        authContext: auth.context,
        action: "BLING_PRODUCT_UPDATE_RESULT",
        entityType: "Product",
        entityId: productId,
        route: "/api/products/bling/update",
        method: "POST",
        confirmation: true,
        status: result.status === "FAILED" ? "FAILED" : "SUCCESS",
        riskLevel: "HIGH",
        summary: result.message,
        metadata: {
          connectionId: parsed.data.connectionId,
          productId,
          externalProductIdMasked: result.externalProductIdMasked,
          fields: result.fields,
          resultCode: result.status,
          replayed: result.replayed === true
        },
        request
      });
    }

    return NextResponse.json({ data: { items, summary: summarizeResults(items) } });
  } catch (error) {
    const safeError = safeRouteError(error);
    return NextResponse.json({ error: safeError.message }, { status: safeError.status });
  }
}
