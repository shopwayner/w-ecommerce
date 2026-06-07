import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const state = await mercadoLivreOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id
    });
    const authorizationUrl = await mercadoLivreOAuthService.buildAuthorizationUrl(state);
    return NextResponse.json({ authorizationUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar OAuth Mercado Livre.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
