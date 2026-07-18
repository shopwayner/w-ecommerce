import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE,
  MercadoLivreOwnerDiagnosticError,
  mercadoLivreOwnerDiagnosticService
} from "@/lib/services/mercado-livre-owner-diagnostic-service";

function canRunOwnerDiagnostic(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function clearResultCookie(response: NextResponse) {
  response.cookies.set(MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/marketplaces/mercado-livre/owner-diagnostic/result",
    maxAge: 0
  });
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;
  if (!canRunOwnerDiagnostic(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  if (!mercadoLivreOwnerDiagnosticService.getStatus().available) {
    return clearResultCookie(
      NextResponse.json({ error: "Diagnostico temporario indisponivel." }, { status: 404 })
    );
  }

  const value = request.cookies.get(MERCADO_LIVRE_OWNER_DIAGNOSTIC_RESULT_COOKIE)?.value;
  if (!value) return NextResponse.json({ error: "Nenhum resultado de diagnostico disponivel." }, { status: 404 });

  try {
    const result = mercadoLivreOwnerDiagnosticService.consumeSignedResult({
      value,
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    return clearResultCookie(NextResponse.json({ result }));
  } catch (error) {
    const status = error instanceof MercadoLivreOwnerDiagnosticError ? error.status : 400;
    const message = error instanceof MercadoLivreOwnerDiagnosticError ? error.message : "Resultado de diagnostico invalido.";
    return clearResultCookie(NextResponse.json({ error: message }, { status }));
  }
}
