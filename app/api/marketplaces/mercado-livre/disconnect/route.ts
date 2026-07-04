import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { mercadoLivreOAuthService } from "@/lib/services/mercado-livre-oauth-service";

export async function POST(request: Request) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { connectionId?: unknown };
  const connectionId = typeof body.connectionId === "string" ? body.connectionId : null;

  try {
    const account = await mercadoLivreOAuthService.disconnectConnection(auth.context.organizationId, auth.context.user.id, connectionId);
    return NextResponse.json({ account, externalWrite: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nao foi possivel desconectar Mercado Livre." },
      { status: 404 }
    );
  }
}
