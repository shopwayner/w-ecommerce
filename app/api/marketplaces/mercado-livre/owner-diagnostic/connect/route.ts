import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE,
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_TTL_SECONDS,
  MercadoLivreOwnerDiagnosticError,
  mercadoLivreOwnerDiagnosticService
} from "@/lib/services/mercado-livre-owner-diagnostic-service";

function canRunOwnerDiagnostic(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canRunOwnerDiagnostic(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  try {
    const authorization = mercadoLivreOwnerDiagnosticService.createAuthorization({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    const response = NextResponse.json({
      authorizationUrl: authorization.authorizationUrl,
      expiresAt: authorization.expiresAt
    });
    response.cookies.set(MERCADO_LIVRE_OWNER_DIAGNOSTIC_NONCE_COOKIE, authorization.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/marketplaces/mercado-livre/callback",
      maxAge: MERCADO_LIVRE_OWNER_DIAGNOSTIC_STATE_TTL_SECONDS
    });
    return response;
  } catch (error) {
    const status = error instanceof MercadoLivreOwnerDiagnosticError ? error.status : 500;
    const message = error instanceof MercadoLivreOwnerDiagnosticError ? error.message : "Nao foi possivel iniciar o diagnostico.";
    return NextResponse.json({ error: message }, { status });
  }
}
