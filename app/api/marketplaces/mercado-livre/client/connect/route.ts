import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { ML_MANAGER_STATE_COOKIE, mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  const envStatus = mercadoLivreClientOAuthService.validateEnvironment();
  if (!envStatus.ok) {
    return NextResponse.json(
      { error: "Configuracao Matrix Marketplace Manager incompleta.", missing: envStatus.missing },
      { status: 400 }
    );
  }

  try {
    const state = await mercadoLivreClientOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    const authorizationUrl = mercadoLivreClientOAuthService.buildAuthorizationUrl(state);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(ML_MANAGER_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/marketplaces/mercado-livre/client",
      maxAge: 10 * 60
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Falha ao iniciar OAuth Mercado Livre Manager." }, { status: 400 });
  }
}
