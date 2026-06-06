import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    await safeCallbackAudit(state, "MERCADOLIVRE_OAUTH_CALLBACK_ERROR", { reason: error ? "provider_error" : "missing_code_or_state" });
    return NextResponse.redirect(new URL("/integrations?mercadolivre=error", request.url));
  }

  try {
    await mercadoLivreOAuthService.completeCallback(code, state);
    return NextResponse.redirect(new URL("/integrations?mercadolivre=success", request.url));
  } catch (callbackError) {
    await safeCallbackAudit(state, "MERCADOLIVRE_OAUTH_CALLBACK_ERROR", {
      reason: callbackError instanceof Error ? callbackError.message : "callback_error"
    });
    return NextResponse.redirect(new URL("/integrations?mercadolivre=error", request.url));
  }
}

async function safeCallbackAudit(state: string | null, action: string, metadata: Record<string, unknown>) {
  if (!state) return;
  const stateRecord = await mercadoLivreOAuthService.validateOAuthState(state);
  if (!stateRecord) return;
  await prisma.auditLog.create({
    data: {
      organizationId: stateRecord.organizationId,
      userId: stateRecord.userId,
      action,
      entity: "MercadoLivreConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}
