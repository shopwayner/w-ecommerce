import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import {
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE,
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE,
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_TTL_SECONDS,
  mercadoLivreOwnerDiagnosticService
} from "@/lib/services/mercado-livre-owner-diagnostic-service";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";
import { sanitizeLogPayload } from "@/lib/utils";
import { getPublicRedirectUrl } from "@/lib/url";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (mercadoLivreOwnerDiagnosticService.isDiagnosticState(state)) {
    return handleOwnerDiagnosticCallback(request, { code, state: state!, providerError: error });
  }

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

async function handleOwnerDiagnosticCallback(
  request: NextRequest,
  input: { code: string | null; state: string; providerError: string | null }
) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok || (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN")) {
    return clearDiagnosticNonce(
      NextResponse.redirect(getPublicRedirectUrl("/integrations?mlOwnerDiagnostic=auth-error", request))
    );
  }

  const nonceCookie = request.cookies.get(MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE)?.value ?? null;
  try {
    const result = input.providerError || !input.code
      ? (() => {
          mercadoLivreOwnerDiagnosticService.consumeState({
            state: input.state,
            nonceCookie,
            organizationId: auth.context.organizationId,
            userId: auth.context.user.id
          });
          return mercadoLivreOwnerDiagnosticService.createFailureResult(
            input.providerError ? "PROVIDER_AUTHORIZATION_ERROR" : "AUTHORIZATION_CODE_MISSING",
            "A autorizacao da conta proprietaria nao foi concluida."
          );
        })()
      : await mercadoLivreOwnerDiagnosticService.run({
          code: input.code,
          state: input.state,
          nonceCookie,
          organizationId: auth.context.organizationId,
          userId: auth.context.user.id
        });

    const signedResult = mercadoLivreOwnerDiagnosticService.createSignedResult({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      result
    });
    const response = NextResponse.redirect(getPublicRedirectUrl("/integrations?mlOwnerDiagnostic=complete", request));
    response.cookies.set(MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE, signedResult, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/marketplaces/mercado-livre/owner-diagnostic/result",
      maxAge: MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_TTL_SECONDS
    });
    return clearDiagnosticNonce(response);
  } catch {
    return clearDiagnosticNonce(
      NextResponse.redirect(getPublicRedirectUrl("/integrations?mlOwnerDiagnostic=error", request))
    );
  }
}

function clearDiagnosticNonce(response: NextResponse) {
  response.cookies.set(MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/marketplaces/mercado-livre/callback",
    maxAge: 0
  });
  return response;
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
