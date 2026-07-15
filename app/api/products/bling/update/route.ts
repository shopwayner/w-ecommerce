import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import {
  BLING_PRODUCT_UPDATE_BLOCK_MESSAGE,
  BLING_PRODUCT_UPDATE_WRITES_BLOCKED,
  blingProductUpdateRequestSchema,
  type BlingProductReviewInput
} from "@/lib/bling-product-update-schema";
import { createAuditLog, logDangerousAction } from "@/lib/services/audit-log-service";
import { blingProductUpdateService } from "@/lib/services/bling-product-update-service";

function maskedReference(value: string) {
  return value.length <= 8 ? `***${value.slice(-4)}` : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function safeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Conta Bling nao encontrada")) return { status: 404, message: "Conta Bling nao encontrada." };
  if (message.includes("Reconecte") || message.includes("reconectada") || message.includes("configurada")) {
    return { status: 409, message: "Reconecte a conta Bling para continuar." };
  }
  if (message.includes("andamento")) return { status: 409, message: "Ja existe uma atualizacao em andamento para esta conta." };
  if (message.toLowerCase().includes("vinculo")) return { status: 409, message: "Revise o vinculo novamente antes de atualizar." };
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

  if (parsed.data.confirmed && BLING_PRODUCT_UPDATE_WRITES_BLOCKED) {
    return NextResponse.json({ error: BLING_PRODUCT_UPDATE_BLOCK_MESSAGE }, { status: 423 });
  }

  const correlationId = maskedReference(randomUUID());
  try {
    if (!parsed.data.confirmed) {
      if (parsed.data.confirmedLinkMismatch) {
        const confirmation = await blingProductUpdateService.confirmLinkMismatch({
          userId: auth.context.user.id,
          organizationId: auth.context.organizationId,
          connectionId: parsed.data.connectionId,
          productId: parsed.data.productId,
          idempotencyKey: parsed.data.idempotencyKey as string
        });
        await logDangerousAction({
          authContext: auth.context,
          action: "USER_CONFIRMED_SAME_PRODUCT",
          entityType: "Product",
          entityId: parsed.data.productId,
          route: "/api/products/bling/update",
          method: "POST",
          confirmation: true,
          status: "SUCCESS",
          riskLevel: "CRITICAL",
          summary: "Usuario confirmou que o produto e o cadastro vinculado no Bling representam o mesmo item.",
          metadata: {
            connectionId: parsed.data.connectionId,
            externalProductIdMasked: confirmation.externalProductIdMasked,
            result: "CONFIRMED"
          },
          request,
          requirePersist: true
        });
        return NextResponse.json({ data: confirmation.preview });
      }
      const preview = await blingProductUpdateService.preview({
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId
      });
      return NextResponse.json({ data: preview });
    }

    const fields = parsed.data.fields as BlingProductReviewInput;
    const idempotencyKey = parsed.data.idempotencyKey as string;
    const idempotencyRef = maskedReference(idempotencyKey);
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
        allowedFields: Object.keys(fields),
        confirmedLinkMismatch: parsed.data.confirmedLinkMismatch,
        correlationId,
        idempotencyRef
      },
      request,
      requirePersist: true
    });

    const result = await blingProductUpdateService.updateOne({
      userId: auth.context.user.id,
      organizationId: auth.context.organizationId,
      connectionId: parsed.data.connectionId,
      productId: parsed.data.productId,
      fields,
      idempotencyKey,
      confirmedLinkMismatch: parsed.data.confirmedLinkMismatch,
      linkMismatchConfirmation: parsed.data.linkMismatchConfirmation
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
        replayed: result.replayed === true,
        correlationId,
        idempotencyRef,
        stage: result.audit?.stage,
        putRequests: result.audit?.putRequests,
        putRequestState: result.audit?.putRequestState,
        verificationGetExecuted: result.audit?.verificationGetExecuted,
        localTimestampUpdated: result.audit?.localTimestampUpdated,
        upstreamStatus: result.audit?.upstreamStatus,
        upstreamCode: result.audit?.upstreamCode,
        upstreamField: result.audit?.upstreamField,
        upstreamFieldCode: result.audit?.upstreamFieldCode,
        upstreamRequestIdMasked: result.audit?.upstreamRequestIdMasked
      },
      request
    });

    const publicResult = { ...result };
    delete publicResult.audit;
    return NextResponse.json({ data: { item: publicResult } });
  } catch (error) {
    const safeError = safeRouteError(error);
    await createAuditLog({
      authContext: auth.context,
      action: "BLING_PRODUCT_UPDATE_RESULT",
      entityType: "Product",
      entityId: parsed.data.productId,
      route: "/api/products/bling/update",
      method: "POST",
      confirmation: parsed.data.confirmed || parsed.data.confirmedLinkMismatch,
      status: "FAILED",
      riskLevel: "HIGH",
      summary: safeError.message,
      metadata: { correlationId, stage: "ROUTE", putRequests: 0 },
      request
    });
    return NextResponse.json({ error: safeError.message }, { status: safeError.status });
  }
}
