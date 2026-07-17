import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiAuth } from "@/lib/auth/api";
import { can } from "@/lib/auth/permissions";
import {
  blingProductUpdateRequestSchema,
  getBlingProductPatchBlock,
  type BlingProductReviewInput
} from "@/lib/bling-product-update-schema";
import { createAuditLog, logDangerousAction } from "@/lib/services/audit-log-service";
import { blingProductUpdateService } from "@/lib/services/bling-product-update-service";

function maskedReference(value: string) {
  return value.length <= 8 ? `***${value.slice(-4)}` : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function requestsImageUpdate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = (value as { fields?: unknown }).fields;
  return Boolean(
    fields
    && typeof fields === "object"
    && !Array.isArray(fields)
    && Object.prototype.hasOwnProperty.call(fields, "images")
  );
}

function safeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Conta Bling nao encontrada")) return { status: 404, message: "Conta Bling nao encontrada." };
  if (message.includes("Reconecte") || message.includes("reconectada") || message.includes("configurada")) {
    return { status: 409, message: "Reconecte a conta Bling para continuar." };
  }
  if (message.includes("andamento")) return { status: 409, message: "Ja existe uma atualizacao em andamento para esta conta." };
  if (message.toLowerCase().includes("revis") && message.toLowerCase().includes("pendente")) {
    return { status: 423, message };
  }
  if (message.toLowerCase().includes("vinculo")) return { status: 409, message: "Revise o vinculo novamente antes de atualizar." };
  if (message.includes("titulo") || message.includes("fotos")) return { status: 400, message };
  return { status: 503, message: "Nao foi possivel atualizar o produto no Bling agora." };
}

export async function POST(request: Request) {
  const auth = await requireApiAuth("products:write");
  if (!auth.ok) return auth.response;
  if (!can(auth.context.role, "integrations:write") || (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")) {
    return NextResponse.json({ error: "Somente administradores podem atualizar produtos no Bling." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (requestsImageUpdate(body)) {
    const imageBlock = getBlingProductPatchBlock("IMAGES_ONLY");
    if (imageBlock) {
      return NextResponse.json(
        { error: imageBlock.message, code: imageBlock.code },
        { status: 423 }
      );
    }
  }
  const parsed = blingProductUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise o produto e tente novamente." }, { status: 400 });
  }

  if (parsed.data.confirmed && parsed.data.operation) {
    const capabilityBlock = getBlingProductPatchBlock(parsed.data.operation);
    if (capabilityBlock) {
      return NextResponse.json(
        { error: capabilityBlock.message, code: capabilityBlock.code },
        { status: 423 }
      );
    }
  }
  if (parsed.data.confirmIncidentReview) {
    const capabilityBlock = getBlingProductPatchBlock("NAME_ONLY");
    if (capabilityBlock) {
      return NextResponse.json(
        { error: capabilityBlock.message, code: capabilityBlock.code },
        { status: 423 }
      );
    }
  }

  const correlationId = maskedReference(randomUUID());
  try {
    if (parsed.data.confirmIncidentReview) {
      const confirmation = await blingProductUpdateService.confirmIncidentReview({
        userId: auth.context.user.id,
        organizationId: auth.context.organizationId,
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId,
        idempotencyKey: parsed.data.idempotencyKey as string
      });
      await logDangerousAction({
        authContext: auth.context,
        action: "BLING_PRODUCT_INCIDENT_REVIEW_CONFIRMED",
        entityType: "Product",
        entityId: parsed.data.productId,
        route: "/api/products/bling/update",
        method: "POST",
        confirmation: true,
        status: "SUCCESS",
        riskLevel: "CRITICAL",
        summary: "Usuario revisou o incidente e liberou somente a atualizacao do nome nesta operacao.",
        metadata: {
          connectionId: parsed.data.connectionId,
          externalProductIdMasked: confirmation.externalProductIdMasked,
          operation: "NAME_ONLY",
          result: "CONFIRMED"
        },
        request,
        requirePersist: true
      });
      return NextResponse.json({ data: confirmation.preview });
    }
    if (!parsed.data.confirmed) {
      if (parsed.data.confirmedLinkMismatch) {
        const confirmation = await blingProductUpdateService.confirmLinkMismatch({
          userId: auth.context.user.id,
          organizationId: auth.context.organizationId,
          connectionId: parsed.data.connectionId,
          productId: parsed.data.productId,
          idempotencyKey: parsed.data.idempotencyKey as string,
          incidentReviewConfirmation: parsed.data.incidentReviewConfirmation
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
            incidentReviewConfirmed: Boolean(parsed.data.incidentReviewConfirmation),
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
      summary: "Atualizacao de titulo ou fotos no Bling confirmada pelo usuario.",
      metadata: {
        connectionId: parsed.data.connectionId,
        productId: parsed.data.productId,
        allowedFields: Object.keys(fields),
        operation: parsed.data.operation,
        confirmedLinkMismatch: parsed.data.confirmedLinkMismatch,
        incidentReviewConfirmed: Boolean(parsed.data.incidentReviewConfirmation),
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
      operation: parsed.data.operation as NonNullable<typeof parsed.data.operation>,
      idempotencyKey,
      incidentReviewConfirmation: parsed.data.incidentReviewConfirmation,
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
        patchRequests: result.audit?.patchRequests,
        patchRequestState: result.audit?.patchRequestState,
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
      confirmation: parsed.data.confirmed || parsed.data.confirmedLinkMismatch || parsed.data.confirmIncidentReview,
      status: "FAILED",
      riskLevel: "HIGH",
      summary: safeError.message,
      metadata: { correlationId, stage: "ROUTE", patchRequests: 0 },
      request
    });
    return NextResponse.json({ error: safeError.message }, { status: safeError.status });
  }
}
