import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import {
  AMAZON_SP_API_STATE_COOKIE,
  amazonSpApiOAuthService
} from "@/lib/services/amazon/amazon-sp-api-oauth-service";

function canManageIntegration(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  if (!canManageIntegration(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  const envStatus = amazonSpApiOAuthService.validateEnvironment();
  if (!envStatus.ok) {
    return NextResponse.json(
      { error: "Configuracao Amazon SP-API Sandbox incompleta.", missing: envStatus.missing },
      { status: 400 }
    );
  }

  try {
    const state = amazonSpApiOAuthService.createState();
    const authorizationUrl = amazonSpApiOAuthService.buildAuthorizationUrl(state);
    const response = NextResponse.redirect(authorizationUrl);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(AMAZON_SP_API_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/integrations/amazon",
      maxAge: amazonSpApiOAuthService.stateTtlSeconds
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Falha ao iniciar conexao Amazon SP-API Sandbox." }, { status: 400 });
  }
}
