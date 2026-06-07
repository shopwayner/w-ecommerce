import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

export async function GET() {
  const auth = await requireApiAuth("integrations:read");
  if (!auth.ok) return auth.response;

  const status = await mercadoLivreOAuthService.getStatus(auth.context.organizationId);
  return NextResponse.json(status);
}

export async function DELETE() {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  try {
    const connection = await mercadoLivreOAuthService.disconnect(auth.context.organizationId, auth.context.user.id);
    return NextResponse.json({ id: connection.id, status: "DISCONNECTED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel desconectar Mercado Livre.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
