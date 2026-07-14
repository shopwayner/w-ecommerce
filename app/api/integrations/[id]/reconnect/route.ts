import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService, getBlingOAuthConfigurationStatus } from "@/lib/services/bling-oauth-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") {
    return NextResponse.json({ error: "Somente administradores podem reconectar uma conta." }, { status: 403 });
  }

  if (!getBlingOAuthConfigurationStatus().configured) {
    return NextResponse.json(
      { error: "A conexão ainda não pode ser renovada. A configuração do Bling precisa ser concluída pelo administrador." },
      { status: 409 }
    );
  }

  const { id } = await params;
  const connection = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!connection) return NextResponse.json({ error: "Conta Bling nao encontrada." }, { status: 404 });

  try {
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      reconnectConnectionId: connection.id
    });
    return NextResponse.json({ authorizationUrl: blingOAuthService.buildAuthorizationUrl(state) });
  } catch {
    return NextResponse.json({ error: "Nao foi possivel iniciar a reconexao agora." }, { status: 400 });
  }
}
