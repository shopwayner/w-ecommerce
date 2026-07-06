import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreClientOAuthService } from "@/lib/services/marketplaces/mercado-livre-client-oauth-service";

function canManageMarketplace(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function POST() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageMarketplace(auth.context.role)) {
    return NextResponse.json({ error: "Permissao insuficiente" }, { status: 403 });
  }

  try {
    const account = await mercadoLivreClientOAuthService.disconnect(auth.context.organizationId, auth.context.user.id);
    return NextResponse.json(account);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel desconectar a conta Mercado Livre.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
