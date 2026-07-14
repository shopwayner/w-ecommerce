import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BlingAccountAlreadyConnectedError,
  BlingReconnectAccountMismatchError,
  blingOAuthService
} from "@/lib/services/bling-oauth-service";
import {
  getBlingCallbackResultPath,
  type BlingCallbackResult
} from "@/lib/services/bling-callback-result";
import { getPublicRedirectUrl } from "@/lib/url";
import { sanitizeLogPayload } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) {
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", { reason: "missing_code_or_state" });
    return publicResultRedirect("connection-error");
  }

  if (!(await blingOAuthService.validateOAuthState(state))) {
    return publicResultRedirect("connection-error");
  }

  if (error) {
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", { reason: "provider_error" });
    return publicResultRedirect("authorization-denied");
  }

  if (!code) {
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", { reason: "missing_code_or_state" });
    return publicResultRedirect("connection-error");
  }

  try {
    const result = await blingOAuthService.completeCallback(code, state);
    return publicResultRedirect(result.mode === "reconnect" ? "reconnected" : "connected");
  } catch (callbackError) {
    if (callbackError instanceof BlingAccountAlreadyConnectedError) {
      return publicResultRedirect("already-connected");
    }
    if (callbackError instanceof BlingReconnectAccountMismatchError) {
      return publicResultRedirect("wrong-account");
    }
    await safeCallbackAudit(state, "BLING_OAUTH_CALLBACK_ERROR", {
      reason: "callback_error"
    });
    return publicResultRedirect("connection-error");
  }
}

function publicResultRedirect(result: BlingCallbackResult) {
  try {
    return NextResponse.redirect(getPublicRedirectUrl(getBlingCallbackResultPath(result)));
  } catch {
    return NextResponse.json(
      { error: "Não foi possível concluir a conexão Bling agora." },
      { status: 500 }
    );
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
