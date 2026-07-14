import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { blingOAuthService } from "@/lib/services/bling-oauth-service";
import { canManageBlingConnection } from "@/lib/services/bling-oauth-url";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth("integrations:write");
  if (!auth.ok) return auth.response;
  if (!canManageBlingConnection(auth.context.role)) {
    return NextResponse.json({ error: "Somente administradores podem reconectar uma conta." }, { status: 403 });
  }

  const { id } = await params;
  const connection = await prisma.blingConnection.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true }
  });
  if (!connection) return NextResponse.json({ error: "Conta Bling nao encontrada." }, { status: 404 });
  if (!(await blingOAuthService.hasUsableCredentials(connection.id, auth.context.organizationId))) {
    return NextResponse.json(
      { error: "A configuração da conta precisa ser revisada." },
      { status: 409 }
    );
  }

  try {
    const state = await blingOAuthService.createOAuthState({
      organizationId: auth.context.organizationId,
      userId: auth.context.user.id,
      reconnectConnectionId: connection.id
    });
    return NextResponse.json({
      success: true,
      authorizationUrl: await blingOAuthService.buildAuthorizationUrl(state)
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível iniciar a conexão agora." }, { status: 400 });
  }
}
