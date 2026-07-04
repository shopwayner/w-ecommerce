import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";
import { getPublicRedirectUrl } from "@/lib/url";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    await safeCallbackAudit(state, {
      status: "error",
      reason: error ? "provider_error" : "missing_code_or_state"
    });
    return NextResponse.redirect(getPublicRedirectUrl("/products/cadastro-inteligente?ml=error", request));
  }

  try {
    await mercadoLivreOAuthService.completeCallback(code, state);
    return NextResponse.redirect(getPublicRedirectUrl("/products/cadastro-inteligente?ml=connected", request));
  } catch (callbackError) {
    await safeCallbackAudit(state, {
      status: "error",
      reason: callbackError instanceof Error ? callbackError.message : "callback_error"
    });
    return NextResponse.redirect(getPublicRedirectUrl("/products/cadastro-inteligente?ml=error", request));
  }
}

async function safeCallbackAudit(state: string | null, metadata: Record<string, unknown>) {
  if (!state) return;
  const stateRecord = await mercadoLivreOAuthService.validateOAuthState(state);
  if (!stateRecord) return;
  await prisma.auditLog.create({
    data: {
      organizationId: stateRecord.organizationId,
      userId: stateRecord.userId,
      action: "MERCADO_LIVRE_CONNECT_ERROR",
      entity: "MercadoLivreConnection",
      entityType: "MercadoLivreConnection",
      status: "FAILED",
      riskLevel: "MEDIUM",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}
