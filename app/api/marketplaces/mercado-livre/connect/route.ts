import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { createAuditLog } from "@/lib/services/audit-log-service";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

export async function GET(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const envStatus = mercadoLivreOAuthService.validateEnvironment();
  if (!envStatus.ok) {
    await createAuditLog({
      authContext: auth.context,
      action: "MERCADO_LIVRE_CONNECT_ERROR",
      entityType: "MercadoLivreConnection",
      method: "GET",
      route: "/api/marketplaces/mercado-livre/connect",
      status: "FAILED",
      riskLevel: "MEDIUM",
      summary: "Configuracao Mercado Livre incompleta no servidor.",
      metadata: { missing: envStatus.missing },
      request
    });
    return NextResponse.json(
      { error: "Configuracao Mercado Livre incompleta no servidor.", missing: envStatus.missing },
      { status: 400 }
    );
  }

  try {
    const state = await mercadoLivreOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    const authorizationUrl = await mercadoLivreOAuthService.buildAuthorizationUrl(state);
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    await createAuditLog({
      authContext: auth.context,
      action: "MERCADO_LIVRE_CONNECT_ERROR",
      entityType: "MercadoLivreConnection",
      method: "GET",
      route: "/api/marketplaces/mercado-livre/connect",
      status: "FAILED",
      riskLevel: "MEDIUM",
      summary: "Falha ao iniciar OAuth Mercado Livre.",
      metadata: { reason: error instanceof Error ? error.message : "unknown_error" },
      request
    });
    return NextResponse.json({ error: "Falha ao iniciar OAuth Mercado Livre." }, { status: 400 });
  }
}
