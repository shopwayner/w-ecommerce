import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import { blingFullProductSyncRequestSchema } from "@/lib/bling-full-product-sync-schema";
import { createAuditLog, logDangerousAction } from "@/lib/services/audit-log-service";
import { blingFullProductSyncService } from "@/lib/services/bling-full-product-sync-service";

function maskReference(value: string) {
  return value.length <= 8 ? `***${value.slice(-4)}` : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("nao encontrado") || message.includes("nao possui vinculo")) {
    return { status: 404, message };
  }
  if (message.includes("Reconecte")) return { status: 409, message };
  if (message.includes("andamento")) return { status: 409, message };
  if (message.includes("temporariamente desativada")) return { status: 423, message };
  if (
    message.includes("previa")
    || message.includes("deposito")
    || message.includes("categoria")
    || message.includes("limite")
    || message.includes("ID externo")
  ) {
    return { status: 400, message };
  }
  if (message.includes("revisao pendente")) return { status: 423, message };
  return { status: 503, message: "Nao foi possivel atualizar o produto no Bling agora." };
}

export async function GET() {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  if (
    !can(auth.context.role, "integrations:write")
    || (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "Somente administradores podem atualizar produtos no Bling." },
      { status: 403 }
    );
  }
  return NextResponse.json({
    data: {
      operation: "FULL_PRODUCT_SYNC",
      enabled: process.env.BLING_FULL_PRODUCT_SYNC_ENABLED === "true"
    }
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  if (
    !can(auth.context.role, "integrations:write")
    || (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")
  ) {
    return NextResponse.json(
      { error: "Somente administradores podem atualizar produtos no Bling." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = blingFullProductSyncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise a atualizacao e tente novamente." }, { status: 400 });
  }

  const { id: productId } = await params;
  try {
    if (parsed.data.dryRun) {
      const preview = await blingFullProductSyncService.preview({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productId,
        idempotencyKey: parsed.data.idempotencyKey
      });
      return NextResponse.json({ data: preview });
    }

    if (process.env.BLING_FULL_PRODUCT_SYNC_ENABLED !== "true") {
      return NextResponse.json(
        { error: "A atualizacao completa de produtos no Bling esta temporariamente desativada." },
        { status: 423 }
      );
    }

    const correlationId = maskReference(randomUUID());
    const idempotencyRef = maskReference(parsed.data.idempotencyKey);
    await logDangerousAction({
      authContext: auth.context,
      action: "BLING_FULL_PRODUCT_SYNC_INTENT",
      entityType: "Product",
      entityId: productId,
      route: `/api/products/${productId}/bling/full-sync`,
      method: "POST",
      confirmation: true,
      status: "SUCCESS",
      riskLevel: "CRITICAL",
      summary: "Atualizacao completa e allowlisted do produto no Bling confirmada pelo usuario.",
      metadata: {
        operation: "FULL_PRODUCT_SYNC",
        connectionId: parsed.data.connectionId,
        correlationId,
        idempotencyRef
      },
      request,
      requirePersist: true
    });

    const result = await blingFullProductSyncService.execute({
      userId: auth.context.user.id,
      organizationId: auth.context.organizationId,
      connectionId: parsed.data.connectionId,
      productId,
      idempotencyKey: parsed.data.idempotencyKey,
      planConfirmation: parsed.data.planConfirmation
    });

    await createAuditLog({
      authContext: auth.context,
      action: "BLING_FULL_PRODUCT_SYNC_RESULT",
      entityType: "Product",
      entityId: productId,
      route: `/api/products/${productId}/bling/full-sync`,
      method: "POST",
      confirmation: true,
      status: ["FAILED", "PARTIAL"].includes(result.status) ? "FAILED" : "SUCCESS",
      riskLevel: "HIGH",
      summary: result.message,
      metadata: {
        operation: result.operation,
        connectionId: parsed.data.connectionId,
        correlationId,
        idempotencyRef,
        resultStatus: result.status,
        modules: result.modules,
        patchRequests: result.patchRequests,
        postRequests: result.postRequests,
        putRequests: result.putRequests,
        retries: result.retries,
        verificationGetExecuted: result.verificationGetExecuted,
        planFingerprint: maskReference(result.planFingerprint),
        divergences: result.divergences,
        replayed: result.replayed === true
      },
      request
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    const safe = safeError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
