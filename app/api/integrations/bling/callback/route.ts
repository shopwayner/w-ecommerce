import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", { reason: error ? "provider_error" : "missing_code_or_state" });
    return NextResponse.redirect(new URL("/integrations?bling=error", request.url));
  }

  try {
    await blingOAuthService.completeCallback(code, state);
    return NextResponse.redirect(new URL("/integrations?bling=success", request.url));
  } catch (callbackError) {
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", {
      reason: callbackError instanceof Error ? callbackError.message : "callback_error"
    });
    return NextResponse.redirect(new URL("/integrations?bling=error", request.url));
  }
}

async function safeCallbackAudit(state: string | null, action: string, metadata: Record<string, unknown>) {
  if (!state) return;
  const stateRecord = await blingOAuthService.validateOAuthState(state);
  if (!stateRecord) return;
  await prisma.auditLog.create({
    data: {
      organizationId: stateRecord.organizationId,
      userId: stateRecord.userId,
      action,
      entity: "BlingConnection",
      metadata: sanitizeLogPayload(metadata) as Prisma.InputJsonObject
    }
  });
}
