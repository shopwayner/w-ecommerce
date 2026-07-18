import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOwnerDiagnosticService } from "@/lib/services/mercado-livre-owner-diagnostic-service";

function canRunOwnerDiagnostic(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;
  if (!canRunOwnerDiagnostic(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  const status = mercadoLivreOwnerDiagnosticService.getStatus();
  if (!status.available) {
    return NextResponse.json({ error: "Diagnostico temporario indisponivel." }, { status: 404 });
  }
  return NextResponse.json({
    enabled: status.enabled,
    searchEnabled: status.searchEnabled,
    available: status.available,
    appIdMatches: status.appIdMatches,
    configured: status.configured,
    expectedAppId: status.expectedAppId
  });
}
